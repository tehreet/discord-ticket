import type { ButtonInteraction } from "discord.js";
import type { SessionStore } from "../storage/store";
import { log } from "../log";

export interface ButtonDeps {
  store: SessionStore;
  enqueue: (threadId: string, message: string) => Promise<void>;
}

const FOOTERS: Record<string, string> = {
  approve: "Approved — filing on GitHub…",
  edit:    "Edit requested — send your changes in the thread.",
  reject:  "Rejected — thread will be closed.",
};

export async function handleButton(deps: ButtonDeps, interaction: ButtonInteraction): Promise<void> {
  const [action, threadId] = interaction.customId.split(":");
  if (!action || !threadId) {
    log.warn({ customId: interaction.customId }, "unrecognized button customId");
    await interaction.deferUpdate();
    return;
  }

  // Combined ack + edit: removes the buttons from the draft card and appends
  // a footer line reflecting the action taken. Must complete within 3s.
  const existing = interaction.message.embeds[0];
  const footer = FOOTERS[action];
  const embedJson = existing ? { ...existing.toJSON() } : null;
  if (embedJson) {
    if (footer) embedJson.footer = { text: footer };
    else if (embedJson.footer === null) delete embedJson.footer;
  }
  await interaction.update({
    components: [],
    embeds: embedJson ? [embedJson] : [],
  });

  if (action === "approve") {
    deps.store.setPhase(threadId, "approved");
    deps.enqueue(threadId, "SYSTEM: user approved draft; file it.").catch(err =>
      log.error({ err, threadId }, "approve-handler enqueue failed"));
  } else if (action === "edit") {
    deps.store.setPhase(threadId, "interviewing");
    deps.enqueue(threadId, "SYSTEM: user clicked Edit. Ask them what to change.").catch(err =>
      log.error({ err, threadId }, "edit-handler enqueue failed"));
  } else if (action === "reject") {
    deps.store.setPhase(threadId, "rejected");
    deps.enqueue(threadId, "SYSTEM: user rejected draft.").catch(err =>
      log.error({ err, threadId }, "reject-handler enqueue failed"));
  } else {
    log.warn({ action }, "unknown button action");
  }
}
