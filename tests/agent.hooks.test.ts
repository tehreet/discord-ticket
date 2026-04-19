import { describe, test, expect } from "bun:test";
import { enforcePhaseGate } from "../src/agent/hooks";
import type { Phase } from "../src/storage/store";

function makeStoreStub(phase: Phase | null) {
  return { getPhase: (_: string) => phase };
}

describe("enforcePhaseGate", () => {
  test("approves unknown tool (not in phase rules)", async () => {
    const hook = enforcePhaseGate("t1", makeStoreStub("new"));
    const r = await hook({ tool_name: "Read", tool_input: {} });
    expect(r.decision).toBe("approve");
  });

  test("blocks create_github_issue in non-approved phases", async () => {
    for (const phase of ["new","interviewing","awaiting_approval","filed","rejected"] as Phase[]) {
      const hook = enforcePhaseGate("t1", makeStoreStub(phase));
      const r = await hook({ tool_name: "mcp__tickets__create_github_issue", tool_input: {} });
      expect(r.decision).toBe("block");
      expect(r.reason).toMatch(/phase/);
    }
  });

  test("allows create_github_issue in approved phase", async () => {
    const hook = enforcePhaseGate("t1", makeStoreStub("approved"));
    const r = await hook({ tool_name: "mcp__tickets__create_github_issue", tool_input: {} });
    expect(r.decision).toBe("approve");
  });

  test("allows present_draft only in interviewing", async () => {
    const tool = "mcp__tickets__present_draft";
    for (const phase of ["new","awaiting_approval","approved","filed","rejected"] as Phase[]) {
      const hook = enforcePhaseGate("t1", makeStoreStub(phase));
      const r = await hook({ tool_name: tool, tool_input: {} });
      expect(r.decision).toBe("block");
    }
    const hook = enforcePhaseGate("t1", makeStoreStub("interviewing"));
    const r = await hook({ tool_name: tool, tool_input: {} });
    expect(r.decision).toBe("approve");
  });

  test("approves interview_reply, apply_tag, search_github_issues, close_thread in any phase", async () => {
    const tools = [
      "mcp__tickets__interview_reply",
      "mcp__tickets__apply_tag",
      "mcp__tickets__search_github_issues",
      "mcp__tickets__close_thread",
    ];
    for (const phase of ["new","interviewing","awaiting_approval","approved","filed","rejected"] as Phase[]) {
      for (const tool of tools) {
        const hook = enforcePhaseGate("t1", makeStoreStub(phase));
        const r = await hook({ tool_name: tool, tool_input: {} });
        expect(r.decision).toBe("approve");
      }
    }
  });

  test("blocks when thread phase is null (unknown thread)", async () => {
    const hook = enforcePhaseGate("t1", makeStoreStub(null));
    const r = await hook({ tool_name: "mcp__tickets__create_github_issue", tool_input: {} });
    expect(r.decision).toBe("block");
  });
});
