import { describe, test, expect, mock } from "bun:test";
import { createTagIndex } from "../src/discord/tags";

describe("createTagIndex", () => {
  test("resolves tag name to tag id", async () => {
    const fetchTags = mock(async () => [
      { id: "1", name: "feature" },
      { id: "2", name: "bug" },
      { id: "3", name: "needs-info" },
    ]);
    const idx = createTagIndex(fetchTags);
    expect(await idx.idFor("needs-info")).toBe("3");
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  test("caches after first call", async () => {
    const fetchTags = mock(async () => [{ id: "1", name: "feature" }]);
    const idx = createTagIndex(fetchTags);
    await idx.idFor("feature");
    await idx.idFor("feature");
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  test("refresh() re-reads on next lookup", async () => {
    let round = 0;
    const fetchTags = mock(async () => round++ === 0
      ? [{ id: "1", name: "a" }]
      : [{ id: "1", name: "a" }, { id: "2", name: "b" }]);
    const idx = createTagIndex(fetchTags);
    await idx.idFor("a");
    idx.refresh();
    expect(await idx.idFor("b")).toBe("2");
  });

  test("throws when tag name doesn't exist", async () => {
    const fetchTags = mock(async () => [{ id: "1", name: "feature" }]);
    const idx = createTagIndex(fetchTags);
    await expect(idx.idFor("nonexistent")).rejects.toThrow(/nonexistent/);
  });
});
