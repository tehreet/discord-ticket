import type { Phase } from "../storage/store";

interface PhaseReader {
  getPhase(threadId: string): Phase | null;
}

const PHASE_RULES: Record<string, Phase[]> = {
  "mcp__tickets__present_draft": ["interviewing"],
  "mcp__tickets__create_github_issue": ["approved"],
};

type HookInput = { tool_name: string; tool_input: unknown };
type HookResult =
  | { decision: "approve" }
  | { decision: "block"; reason: string };

export function enforcePhaseGate(threadId: string, store: PhaseReader) {
  return async (input: HookInput): Promise<HookResult> => {
    const rule = PHASE_RULES[input.tool_name];
    if (!rule) return { decision: "approve" };

    const phase = store.getPhase(threadId);
    if (phase === null) {
      return { decision: "block", reason: `No phase recorded for thread ${threadId}` };
    }
    if (!rule.includes(phase)) {
      return {
        decision: "block",
        reason: `Tool ${input.tool_name} not allowed in phase '${phase}'. ` +
                `Allowed phases: ${rule.join(", ")}.`
      };
    }
    return { decision: "approve" };
  };
}
