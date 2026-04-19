import {
  Client, GatewayIntentBits, Events, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type ForumChannel, type ForumThreadChannel, type AnyThreadChannel,
  type Message, type ButtonInteraction,
} from "discord.js";
import type { Config } from "../config";
import type { SessionStore } from "../storage/store";
import type { DiscordPoster } from "../agent/tools";
import { createTagIndex, type FetchTags } from "./tags";
import { handleButton } from "./buttons";
import { log } from "../log";

export interface ClientDeps {
  config: Config;
  store: SessionStore;
  enqueue: (threadId: string, msg: string) => Promise<void>;
}

export function createDiscord(deps: ClientDeps) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const fetchTags: FetchTags = async () => {
    const ch = await client.channels.fetch(deps.config.DISCORD_FORUM_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildForum) {
      throw new Error("Configured channel is not a forum channel");
    }
    return (ch as ForumChannel).availableTags.map(t => ({ id: t.id, name: t.name }));
  };
  const tagIndex = createTagIndex(fetchTags);

  const poster: DiscordPoster = {
    async postMessage(threadId, content) {
      const ch = await client.channels.fetch(threadId);
      if (!ch?.isThread()) throw new Error(`Channel ${threadId} is not a thread`);
      await (ch as AnyThreadChannel).send({ content });
    },
    async postDraft(threadId, draft) {
      const ch = await client.channels.fetch(threadId);
      if (!ch?.isThread()) throw new Error(`Channel ${threadId} is not a thread`);
      const embed = new EmbedBuilder()
        .setTitle(draft.title)
        .setDescription(draft.body.slice(0, 4000))
        .setFooter({ text: `Labels: ${draft.labels.join(", ") || "—"}` });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`approve:${threadId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`edit:${threadId}`).setLabel("Edit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`reject:${threadId}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
      );
      await (ch as AnyThreadChannel).send({ embeds: [embed], components: [row] });
    },
    async applyTag(threadId, tagId) {
      const ch = await client.channels.fetch(threadId);
      if (!ch?.isThread()) throw new Error(`Channel ${threadId} is not a thread`);
      const thread = ch as ForumThreadChannel;
      const current = thread.appliedTags ?? [];
      if (!current.includes(tagId)) {
        await thread.setAppliedTags([...current, tagId]);
      }
    },
    async closeThread(threadId) {
      const ch = await client.channels.fetch(threadId);
      if (!ch?.isThread()) throw new Error(`Channel ${threadId} is not a thread`);
      await (ch as AnyThreadChannel).edit({ archived: true, locked: true });
    },
  };

  client.on(Events.ClientReady, async () => {
    log.info({ user: client.user?.tag }, "discord ready");
    await replayMissedMessages(client, deps);
  });

  client.on(Events.ThreadCreate, async (thread) => {
    log.info({ threadId: thread.id, parentId: thread.parentId, configuredForum: deps.config.DISCORD_FORUM_CHANNEL_ID, name: thread.name }, "thread_create event");
    if (thread.parentId !== deps.config.DISCORD_FORUM_CHANNEL_ID) return;
    log.info({ threadId: thread.id, name: thread.name }, "thread created");
    deps.store.insertThread(thread.id);
  });

  client.on(Events.MessageCreate, async (msg: Message) => {
    if (msg.author.bot) return;
    const parentId = msg.channel.isThread() ? msg.channel.parentId : null;
    log.info({ messageId: msg.id, channelId: msg.channelId, isThread: msg.channel.isThread(), parentId, configuredForum: deps.config.DISCORD_FORUM_CHANNEL_ID, contentLength: msg.content.length }, "message_create event");
    if (!msg.channel.isThread()) return;
    if (msg.channel.parentId !== deps.config.DISCORD_FORUM_CHANNEL_ID) return;

    // Thread's starter message for a forum post has the same id as the thread,
    // and ThreadCreate fires first — so the row should exist. Defensive insert.
    deps.store.insertThread(msg.channelId);
    deps.store.setLastSeenMessage(msg.channelId, msg.id);

    const body = msg.content.trim();
    if (!body) return;
    log.info({ threadId: msg.channelId, messageId: msg.id }, "message received");
    deps.enqueue(msg.channelId, body).catch(err =>
      log.error({ err, threadId: msg.channelId }, "enqueue failed"));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    try {
      await handleButton({ store: deps.store, enqueue: deps.enqueue }, interaction as ButtonInteraction);
    } catch (err) {
      log.error({ err }, "button handler failed");
    }
  });

  return {
    client,
    poster,
    tagIndex,
    async start() { await client.login(deps.config.DISCORD_TOKEN); },
  };
}

async function replayMissedMessages(client: Client, deps: ClientDeps) {
  const active = deps.store.listActiveThreads();
  for (const row of active) {
    try {
      const ch = await client.channels.fetch(row.thread_id);
      if (!ch?.isThread()) continue;
      const after = row.last_seen_message_id ?? "0";
      const messages = await ch.messages.fetch({ after, limit: 50 });
      const sorted = Array.from(messages.values())
        .filter(m => !m.author.bot && m.content.trim())
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
      for (const m of sorted) {
        deps.store.setLastSeenMessage(row.thread_id, m.id);
        await deps.enqueue(row.thread_id, m.content.trim());
      }
      if (sorted.length > 0) {
        log.info({ threadId: row.thread_id, count: sorted.length }, "replayed missed messages");
      }
    } catch (err) {
      log.warn({ err, threadId: row.thread_id }, "replay failed for thread");
    }
  }
}
