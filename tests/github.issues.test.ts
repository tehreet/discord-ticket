import { describe, test, expect, mock } from "bun:test";
import { createGithub } from "../src/github/issues";

describe("github/issues", () => {
  test("searchIssues calls gh with correct args and returns parsed JSON", async () => {
    const exec = mock(async (cmd: string, args: string[]) => ({
      stdout: JSON.stringify([{ number: 47, title: "hi", state: "open", url: "u", body: "b" }]),
      stderr: "", code: 0,
    }));
    const gh = createGithub({ repo: "o/r", exec });
    const res = await gh.searchIssues("chat lobby", "open");
    expect(exec).toHaveBeenCalled();
    const [_, args] = exec.mock.calls[0]!;
    expect(args).toContain("--repo");
    expect(args).toContain("o/r");
    expect(args).toContain("--search");
    expect(args).toContain("chat lobby");
    expect(args).toContain("--state");
    expect(args).toContain("open");
    expect(res).toEqual([{ number: 47, title: "hi", state: "open", url: "u", body: "b" }]);
  });

  test("createIssue shells gh issue create and returns the URL", async () => {
    const exec = mock(async () => ({
      stdout: "https://github.com/o/r/issues/112\n",
      stderr: "", code: 0,
    }));
    const gh = createGithub({ repo: "o/r", exec });
    const url = await gh.createIssue({ title: "T", body: "B", labels: ["feature","ui"] });
    expect(url).toBe("https://github.com/o/r/issues/112");
    const [_, args] = exec.mock.calls[0]!;
    expect(args).toContain("--title");
    expect(args).toContain("T");
    expect(args).toContain("--body");
    expect(args).toContain("B");
    expect(args).toContain("--label");
    expect(args).toContain("feature,ui");
  });

  test("createIssue throws when gh exits non-zero", async () => {
    const exec = mock(async () => ({ stdout: "", stderr: "nope", code: 1 }));
    const gh = createGithub({ repo: "o/r", exec });
    await expect(gh.createIssue({ title: "T", body: "B", labels: [] })).rejects.toThrow(/nope/);
  });

  test("searchIssues returns [] when gh returns empty stdout", async () => {
    const exec = mock(async () => ({ stdout: "", stderr: "", code: 0 }));
    const gh = createGithub({ repo: "o/r", exec });
    expect(await gh.searchIssues("x")).toEqual([]);
  });
});
