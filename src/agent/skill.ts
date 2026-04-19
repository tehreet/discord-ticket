import { readFileSync } from "node:fs";

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

export function loadSkill(path: string): string {
  const raw = readFileSync(path, "utf8");
  const body = raw.replace(FRONTMATTER, "").trim();
  if (!body) throw new Error(`Skill at ${path} is empty after stripping frontmatter`);
  return body;
}
