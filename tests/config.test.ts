import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("returns typed config when all env vars set", () => {
    const env = {
      DISCORD_TOKEN: "t",
      DISCORD_CLIENT_ID: "c",
      DISCORD_GUILD_ID: "g",
      DISCORD_FORUM_CHANNEL_ID: "f",
      ANTHROPIC_API_KEY: "a",
      GITHUB_REPO: "owner/repo",
      REPO_CLONE_PATH: "/tmp/clone",
      STATE_DB_PATH: "/tmp/state.db",
      LOG_LEVEL: "info",
    };
    const cfg = loadConfig(env);
    expect(cfg.DISCORD_TOKEN).toBe("t");
    expect(cfg.GITHUB_REPO).toBe("owner/repo");
    expect(cfg.LOG_LEVEL).toBe("info");
  });

  test("throws when a required var is missing", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: "t" })).toThrow();
  });

  test("defaults LOG_LEVEL to info when omitted", () => {
    const env = {
      DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c", DISCORD_GUILD_ID: "g",
      DISCORD_FORUM_CHANNEL_ID: "f", ANTHROPIC_API_KEY: "a",
      GITHUB_REPO: "o/r", REPO_CLONE_PATH: "/x", STATE_DB_PATH: "/y",
    };
    expect(loadConfig(env).LOG_LEVEL).toBe("info");
  });

  test("rejects GITHUB_REPO without owner/repo shape", () => {
    const env = {
      DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c", DISCORD_GUILD_ID: "g",
      DISCORD_FORUM_CHANNEL_ID: "f", ANTHROPIC_API_KEY: "a",
      GITHUB_REPO: "no-slash", REPO_CLONE_PATH: "/x", STATE_DB_PATH: "/y",
    };
    expect(() => loadConfig(env)).toThrow(/GITHUB_REPO/);
  });
});
