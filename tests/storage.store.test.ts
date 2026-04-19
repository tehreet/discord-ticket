import { describe, test, expect, beforeEach } from "bun:test";
import { SessionStore, type Phase } from "../src/storage/store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

function newStore() {
  const path = join(tmpdir(), `dt-test-${Date.now()}-${Math.random()}.db`);
  return { store: new SessionStore(path), path };
}

describe("SessionStore", () => {
  test("insertThread creates a row with phase=new", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    expect(store.getPhase("t1")).toBe("new");
    rmSync(path);
  });

  test("insertThread is idempotent", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    store.insertThread("t1"); // does not throw
    expect(store.getPhase("t1")).toBe("new");
    rmSync(path);
  });

  test("setPhase updates the row", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    store.setPhase("t1", "interviewing");
    expect(store.getPhase("t1")).toBe("interviewing");
    rmSync(path);
  });

  test("getPhase returns null for unknown thread", () => {
    const { store, path } = newStore();
    expect(store.getPhase("nope")).toBeNull();
    rmSync(path);
  });

  test("setSession / getSession round trip", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    store.setSession("t1", "sess-abc");
    expect(store.getSession("t1")).toBe("sess-abc");
    rmSync(path);
  });

  test("setDraft stores JSON and retrieves it", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    const draft = { title: "T", body: "B", labels: ["feature"] };
    store.setDraft("t1", draft);
    expect(store.getDraft("t1")).toEqual(draft);
    rmSync(path);
  });

  test("setLastSeenMessage stores the id", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    store.setLastSeenMessage("t1", "msg-123");
    const row = store.getThread("t1");
    expect(row?.last_seen_message_id).toBe("msg-123");
    rmSync(path);
  });

  test("listActiveThreads excludes filed and rejected", () => {
    const { store, path } = newStore();
    store.insertThread("a");
    store.insertThread("b");
    store.insertThread("c");
    store.setPhase("b", "filed");
    store.setPhase("c", "rejected");
    const active = store.listActiveThreads().map(r => r.thread_id).sort();
    expect(active).toEqual(["a"]);
    rmSync(path);
  });

  test("setIssueNumber writes the field and flips phase to filed", () => {
    const { store, path } = newStore();
    store.insertThread("t1");
    store.setPhase("t1", "approved");
    store.setIssueNumber("t1", 42);
    expect(store.getThread("t1")?.github_issue_number).toBe(42);
    expect(store.getPhase("t1")).toBe("filed");
    rmSync(path);
  });
});
