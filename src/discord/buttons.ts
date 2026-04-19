import type { ButtonInteraction } from "discord.js";
import type { SessionStore } from "../storage/store";
import { log } from "../log";

export interface ButtonDeps {
  store: SessionStore;
  enqueue: (threadId: string, message: string) => Promise<void>;
}

export function handleButton(deps: ButtonDeps, interaction: ButtonInteraction): Promise<void> {
  const [action, threadId] = interaction.customId.split(":");
  if (!action || !threadId) {
    log.warn({ customId: interaction.customId }, "unrecognized button customId");
    return interaction.deferUpdate().then(() => undefined);
  }

  // MUST ack within 3 seconds.
  const ack = interaction.deferUpdate().then(() => undefined);

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

  return ack;
}
