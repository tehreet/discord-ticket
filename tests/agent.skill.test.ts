import { describe, test, expect } from "bun:test";
import { loadSkill } from "../src/agent/skill";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadSkill", () => {
  test("strips YAML frontmatter and returns body", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"));
    const path = join(dir, "SKILL.md");
    writeFileSync(path, `---\nname: test\ndescription: x\n---\n\nHello world.\n`);
    expect(loadSkill(path)).toBe("Hello world.");
  });

  test("returns full content when no frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"));
    const path = join(dir, "SKILL.md");
    writeFileSync(path, `No frontmatter here.`);
    expect(loadSkill(path)).toBe("No frontmatter here.");
  });

  test("throws when the file is missing", () => {
    expect(() => loadSkill("/nope/nope.md")).toThrow();
  });

  test("throws when content is empty after stripping", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"));
    const path = join(dir, "SKILL.md");
    writeFileSync(path, `---\nname: test\n---\n`);
    expect(() => loadSkill(path)).toThrow(/empty/);
  });
});
