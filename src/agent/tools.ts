import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SessionStore } from "../storage/store";
import type { Github } from "../github/issues";
import type { TagIndex } from "../discord/tags";
import { log } from "../log";

export interface DiscordPoster {
  postMessage(threadId: string, content: string): Promise<void>;
  postDraft(threadId: string, draft: { title: string; body: string; labels: string[] }): Promise<void>;
  applyTag(threadId: string, tagId: string): Promise<void>;
  setAppliedTags(threadId: string, tagIds: string[]): Promise<void>;
  getAppliedTagIds(threadId: string): Promise<string[]>;
  closeThread(threadId: string): Promise<void>;
}

// State tags are mutually exclusive — applying one should remove the others.
// Category tags (feature/bug/question) are left alone.
const STATE_TAGS = ["needs-info", "ready-to-file", "filed", "duplicate", "already-done", "wont-do"] as const;
type StateTag = typeof STATE_TAGS[number];

function isStateTag(name: string): name is StateTag {
  return (STATE_TAGS as readonly string[]).includes(name);
}

async function applyStateTag(
  tid: string,
  newTagName: StateTag,
  tags: TagIndex,
  discord: DiscordPoster,
): Promise<void> {
  const newTagId = await tags.idFor(newTagName);
  const [currentIds, stateTagIds] = await Promise.all([
    discord.getAppliedTagIds(tid),
    Promise.all(STATE_TAGS.map(n => tags.idFor(n).catch(() => null))),
  ]);
  const stateIdSet = new Set(stateTagIds.filter((x): x is string => x !== null));
  const keep = currentIds.filter(id => !stateIdSet.has(id));
  keep.push(newTagId);
  await discord.setAppliedTags(tid, keep);
}

export interface ToolDeps {
  store: SessionStore;
  github: Github;
  tags: TagIndex;
  discord: DiscordPoster;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function createTicketsServer(deps: ToolDeps) {
  const { store, github, tags, discord } = deps;

  // Dedup: Claude occasionally emits the same tool_use block twice in one turn.
  // Track recent content per thread per tool; skip if we just posted the same thing.
  const DEDUP_WINDOW_MS = 30_000;
  const recentPosts = new Map<string, { content: string; time: number }>();
  const isDuplicate = (key: string, content: string) => {
    const last = recentPosts.get(key);
    const now = Date.now();
    if (last && last.content === content && now - last.time < DEDUP_WINDOW_MS) return true;
    recentPosts.set(key, { content, time: now });
    // Opportunistic cleanup — keep the map small.
    if (recentPosts.size > 256) {
      for (const [k, v] of recentPosts) {
        if (now - v.time > DEDUP_WINDOW_MS) recentPosts.delete(k);
      }
    }
    return false;
  };

  return createSdkMcpServer({
    name: "tickets",
    version: "1.0.0",
    tools: [
      tool(
        "interview_reply",
        "Post a plain-text reply in the current Discord thread. Short (1-3 sentences). The thread is inferred from conversation context — do not pass any thread ID. If current phase is 'new', this automatically transitions it to 'interviewing'.",
        { content: z.string().min(1).max(2000) },
        async ({ content }) => {
          const tid = currentThreadId();
          if (!tid) throw new Error("No active thread for this tool call");
          if (isDuplicate(`interview_reply:${tid}`, content)) {
            log.warn({ tid }, "interview_reply: duplicate content within 30s, skipping");
            return ok("Reply posted. (duplicate suppressed)");
          }
          await discord.postMessage(tid, content);
          if (store.getPhase(tid) === "new") store.setPhase(tid, "interviewing");
          return ok("Reply posted.");
        }
      ),
      tool(
        "present_draft",
        "Post the drafted GitHub issue in the current Discord thread as a card with Approve/Edit/Reject buttons. The thread is inferred from conversation context — do not pass any thread ID. Transitions phase to 'awaiting_approval'. Replaces any prior draft.",
        {
          title: z.string().min(1).max(100),
          body: z.string().min(1),
          suggested_labels: z.array(z.string()).default([]),
        },
        async ({ title, body, suggested_labels }) => {
          const tid = currentThreadId();
          if (!tid) throw new Error("No active thread for this tool call");
          const draft = { title, body, labels: suggested_labels };
          const signature = JSON.stringify(draft);
          if (isDuplicate(`present_draft:${tid}`, signature)) {
            log.warn({ tid }, "present_draft: duplicate draft within 30s, skipping");
            return ok("Draft posted. (duplicate suppressed)");
          }
          store.setDraft(tid, draft);
          await discord.postDraft(tid, draft);
          store.setPhase(tid, "awaiting_approval");
          try {
            await applyStateTag(tid, "ready-to-file", tags, discord);
          } catch (err) { log.warn({ err }, "failed to apply ready-to-file tag"); }
          return ok("Draft posted. Phase=awaiting_approval.");
        }
      ),
      tool(
        "apply_tag",
        "Set the state tag on the current Discord thread. Valid tag names: 'needs-info', 'ready-to-file', 'filed', 'duplicate', 'already-done', 'wont-do'. These are mutually exclusive — applying one automatically removes any previous state tag. Category tags (feature/bug/question) are preserved. The thread is inferred from conversation context — do not pass any thread ID.",
        { tag_name: z.string() },
        async ({ tag_name }) => {
          const tid = currentThreadId();
          if (!tid) throw new Error("No active thread for this tool call");
          if (isStateTag(tag_name)) {
            await applyStateTag(tid, tag_name, tags, discord);
          } else {
            const id = await tags.idFor(tag_name);
            await discord.applyTag(tid, id);
          }
          return ok(`Applied tag '${tag_name}'.`);
        }
      ),
      tool(
        "search_github_issues",
        "Search the promptionary repo for open or closed issues. Returns JSON array of {number,title,state,url,body}. Use to detect duplicates.",
        {
          query: z.string().min(1),
          state: z.enum(["open", "closed", "all"]).default("all"),
        },
        async ({ query, state }) => {
          const results = await github.searchIssues(query, state);
          return ok(JSON.stringify(results, null, 2));
        }
      ),
      tool(
        "create_github_issue",
        "File the drafted issue on GitHub. ONLY callable after user has clicked Approve (phase=approved). The phase gate will block this in any other phase.",
        {
          title: z.string().min(1).max(100),
          body: z.string().min(1),
          labels: z.array(z.string()).default([]),
        },
        async ({ title, body, labels }) => {
          // The Agent SDK handler doesn't natively pass our thread context.
          // Runner sets AsyncLocalStorage before each query; we read it here.
          const tid = currentThreadId();
          if (!tid) throw new Error("No active thread for this tool call");
          const row = store.getThread(tid);
          if (!row) throw new Error(`Thread ${tid} not found in store`);
          // Idempotent: if we already filed for this thread, return the same URL
          // rather than creating a duplicate issue.
          if (row.github_issue_number !== null) {
            const repo = process.env.GITHUB_REPO;
            return ok(`https://github.com/${repo}/issues/${row.github_issue_number}`);
          }
          if (row.phase !== "approved") throw new Error(`Cannot file in phase '${row.phase}'`);
          const url = await github.createIssue({ title, body, labels });
          const match = url.match(/\/issues\/(\d+)/);
          if (match) store.setIssueNumber(tid, parseInt(match[1]!, 10));
          return ok(url);
        }
      ),
      tool(
        "close_thread",
        "Archive + lock the current Discord thread. The thread is inferred from conversation context — do not pass any thread ID. Call this after 'filed', 'duplicate', 'already-done', or 'wont-do'. Terminal action.",
        { reason: z.string().min(1).describe("Brief reason for closing, e.g. 'filed as #42' or 'duplicate of #47'") },
        async ({ reason: _reason }) => {
          const tid = currentThreadId();
          if (!tid) throw new Error("No active thread for this tool call");
          await discord.closeThread(tid);
          return ok("Thread closed.");
        }
      ),
    ],
  });
}

// ---- thread-context plumbing ------------------------------------------------
// The Agent SDK doesn't pass thread_id through to tool handlers natively.
// The runner sets this before each query() call via AsyncLocalStorage so that
// create_github_issue can look up the right row in the store.
import { AsyncLocalStorage } from "node:async_hooks";
const threadContext = new AsyncLocalStorage<string>();

export function withThreadContext<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  return threadContext.run(threadId, fn);
}

function currentThreadId(): string | undefined {
  return threadContext.getStore();
}
