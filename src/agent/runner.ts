// src/agent/runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStore } from "../storage/store";
import { enforcePhaseGate } from "./hooks";
import { withThreadContext } from "./tools";
import { log } from "../log";

export interface RunnerDeps {
  store: SessionStore;
  systemPrompt: string;
  cwd: string;
  pullRepo: () => Promise<void>;
  ticketsServer: McpSdkServerConfigWithInstance;
  notifyStuck: (threadId: string) => Promise<void>;
}

const ALLOWED_TOOLS = [
  "Read", "Grep", "Glob",
  "mcp__tickets__interview_reply",
  "mcp__tickets__present_draft",
  "mcp__tickets__apply_tag",
  "mcp__tickets__search_github_issues",
  "mcp__tickets__create_github_issue",
  "mcp__tickets__close_thread",
];

export function createAgentRunner(deps: RunnerDeps) {
  const queues = new Map<string, Promise<void>>();

  async function runOnce(threadId: string, userMessage: string) {
    const sessionId = deps.store.getSession(threadId);
    const enforcer = enforcePhaseGate(threadId, deps.store);

    // Wrap enforcer to match HookCallback signature: (input, toolUseID, options) => Promise<HookJSONOutput>
    const hookCb: HookCallback = async (input, _toolUseID, _options) => {
      return enforcer(input as { tool_name: string; tool_input: unknown });
    };

    await withThreadContext(threadId, async () => {
      for await (const msg of query({
        prompt: userMessage,
        options: {
          systemPrompt: deps.systemPrompt,
          cwd: deps.cwd,
          mcpServers: { tickets: deps.ticketsServer },
          allowedTools: ALLOWED_TOOLS,
          resume: sessionId ?? undefined,
          hooks: {
            PreToolUse: [{ hooks: [hookCb] }],
          },
        },
      })) {
        if (msg.type === "result" && msg.session_id) {
          deps.store.setSession(threadId, msg.session_id);
        }
      }
    });
  }

  async function runTurn(threadId: string, userMessage: string) {
    await deps.pullRepo();
    const delays = [1000, 4000, 16000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await runOnce(threadId, userMessage);
        return;
      } catch (err) {
        lastErr = err;
        log.warn({ err, threadId, attempt }, "agent turn failed, will retry");
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    log.error({ err: lastErr, threadId }, "agent turn exhausted retries");
    try { await deps.notifyStuck(threadId); } catch (e) {
      log.error({ err: e, threadId }, "failed to notify user of stuck agent");
    }
  }

  return {
    enqueue(threadId: string, userMessage: string): Promise<void> {
      const prev = queues.get(threadId) ?? Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(() => runTurn(threadId, userMessage));
      queues.set(threadId, next);
      return next;
    },
  };
}
