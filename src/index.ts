// src/index.ts
import { loadConfig } from "./config";
import { log } from "./log";
import { SessionStore } from "./storage/store";
import { createGithub, resolveGithubToken } from "./github/issues";
import { createRepoPuller, bunExec } from "./repo/pull";
import { loadSkill } from "./agent/skill";
import { createTicketsServer } from "./agent/tools";
import type { DiscordPoster } from "./agent/tools";
import { createAgentRunner } from "./agent/runner";
import { createDiscord } from "./discord/client";
import type { TagIndex } from "./discord/tags";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cfg = loadConfig();
const store = new SessionStore(cfg.STATE_DB_PATH);
const githubToken = await resolveGithubToken();
const github = createGithub({ repo: cfg.GITHUB_REPO, token: githubToken });
const pullRepo = createRepoPuller({ path: cfg.REPO_CLONE_PATH, exec: bunExec });

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, "..", ".claude", "skills", "feature-request-interviewer", "SKILL.md");
const systemPrompt = `Discord Guild ID: ${cfg.DISCORD_GUILD_ID}
GitHub Repo: ${cfg.GITHUB_REPO}

` + loadSkill(skillPath);

// Two-phase wiring: Discord client needs enqueue; runner needs poster+tags via tools.
// Solution: construct runner lazily by passing a mutable `poster` holder.
let poster: DiscordPoster | null = null;
let tagIndex: TagIndex | null = null;

const ticketsServer = createTicketsServer({
  store,
  github,
  // Lazy proxies — must be set before any query runs.
  // Safe because discord.start() resolves before any enqueue() call.
  tags: { idFor: async (n) => tagIndex!.idFor(n), refresh: () => tagIndex!.refresh() },
  discord: {
    postMessage:      async (t, c)  => poster!.postMessage(t, c),
    postDraft:        async (t, d)  => poster!.postDraft(t, d),
    applyTag:         async (t, i)  => poster!.applyTag(t, i),
    setAppliedTags:   async (t, is) => poster!.setAppliedTags(t, is),
    getAppliedTagIds: async (t)     => poster!.getAppliedTagIds(t),
    closeThread:      async (t)     => poster!.closeThread(t),
  },
});

const runner = createAgentRunner({
  store,
  systemPrompt,
  cwd: cfg.REPO_CLONE_PATH,
  pullRepo,
  ticketsServer,
  notifyStuck: async (threadId) =>
    poster!.postMessage(threadId, "House MD is thinking. Try again in a minute."),
});

const discord = createDiscord({
  config: cfg,
  store,
  enqueue: (tid, msg) => runner.enqueue(tid, msg),
});

poster = discord.poster;
tagIndex = discord.tagIndex;

discord.start()
  .then(() => log.info("bot started"))
  .catch((err) => { log.error({ err }, "startup failed"); process.exit(1); });

process.on("SIGTERM", () => { log.info("SIGTERM received"); process.exit(0); });
process.on("SIGINT",  () => { log.info("SIGINT received");  process.exit(0); });
