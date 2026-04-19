import type { ButtonInteraction } from "discord.js";
import type { SessionStore } from "../storage/store";
import { log } from "../log";

export interface ButtonDeps {
  store: SessionStore;
  enqueue: (threadId: string, message: string) => Promise<void>;
  /** URL of the local build-bot /events/internal endpoint (defaults to localhost:8081). */
  buildBotEventsUrl?: string;
}

const FOOTERS: Record<string, string> = {
  approve: "Approved — filing on GitHub…",
  edit:    "Edit requested — send your changes in the thread.",
  reject:  "Rejected — thread will be closed.",
  ship:    "Approved — promoting to production…",
};

export async function handleButton(deps: ButtonDeps, interaction: ButtonInteraction): Promise<void> {
  const [action, payload] = interaction.customId.split(":");
  if (!action || !payload) {
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

  // Ticket-bot–owned flows: action+threadId customIds
  if (action === "approve") {
    deps.store.setPhase(payload, "approved");
    deps.enqueue(payload, "SYSTEM: user approved draft; file it.").catch(err =>
      log.error({ err, threadId: payload }, "approve-handler enqueue failed"));
    return;
  }
  if (action === "edit") {
    deps.store.setPhase(payload, "interviewing");
    deps.enqueue(payload, "SYSTEM: user clicked Edit. Ask them what to change.").catch(err =>
      log.error({ err, threadId: payload }, "edit-handler enqueue failed"));
    return;
  }
  if (action === "reject") {
    deps.store.setPhase(payload, "rejected");
    deps.enqueue(payload, "SYSTEM: user rejected draft.").catch(err =>
      log.error({ err, threadId: payload }, "reject-handler enqueue failed"));
    return;
  }

  // Build-bot–owned flow: ship:<issue_number>
  if (action === "ship") {
    const issueNumber = parseInt(payload, 10);
    if (Number.isNaN(issueNumber)) {
      log.warn({ customId: interaction.customId }, "ship button: bad issue number");
      return;
    }
    const url = deps.buildBotEventsUrl ?? "http://127.0.0.1:8081/events/internal";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ship", issue_number: issueNumber }),
    }).catch(err => log.error({ err, issueNumber }, "ship handoff to build-bot failed"));
    return;
  }

  log.warn({ action }, "unknown button action");
}
