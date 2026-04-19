import { describe, test, expect, mock } from "bun:test";
import { createRepoPuller } from "../src/repo/pull";
import type { Exec } from "../src/repo/pull";

describe("createRepoPuller", () => {
  test("calls git pull --ff-only in the configured path", async () => {
    const exec = mock<Exec>(async () => ({ stdout: "", stderr: "", code: 0 }));
    const pull = createRepoPuller({ path: "/tmp/clone", exec });
    await pull();
    const [cmd, args] = exec.mock.calls[0]!;
    expect(cmd).toBe("git");
    expect(args).toEqual(["-C", "/tmp/clone", "pull", "--ff-only", "--quiet"]);
  });

  test("swallows errors and resolves — stale context is better than crash", async () => {
    const exec = mock(async () => ({ stdout: "", stderr: "conflict", code: 1 }));
    const pull = createRepoPuller({ path: "/tmp/clone", exec });
    await expect(pull()).resolves.toBeUndefined();
  });
});
