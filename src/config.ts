import { z } from "zod";

const Schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_FORUM_CHANNEL_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GITHUB_REPO: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "GITHUB_REPO must be 'owner/repo'"),
  REPO_CLONE_PATH: z.string().min(1),
  STATE_DB_PATH: z.string().min(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Invalid env: " + JSON.stringify(parsed.error.issues, null, 2));
  }
  return parsed.data;
}
