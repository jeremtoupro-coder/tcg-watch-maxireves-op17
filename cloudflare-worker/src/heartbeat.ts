import { dispatchDiscordPayloads } from "./discord";
import type { DurableCycleResult, RuntimeEnv } from "./durableMonitoring";
import type { DiscordPayload } from "./types";

export const HEARTBEAT_INTERVAL_MINUTES = 12 * 60;

export function isHeartbeatTick(scheduledTime: number): boolean {
  const minuteBucket = Math.floor(scheduledTime / 60_000);
  return minuteBucket % HEARTBEAT_INTERVAL_MINUTES === 0;
}

function parisDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris"
  }).format(new Date(iso));
}

export function buildRuntimeHeartbeatPayload(cycle: DurableCycleResult): DiscordPayload {
  const checkedAt = new Date(cycle.scheduledTime).toISOString();
  const incidents = cycle.stores.filter((store) =>
    store.status === "error" || store.status === "degraded" || store.status === "backoff"
  );
  const completed = cycle.stores.filter((store) => store.status === "completed").length;
  const title = incidents.length === 0
    ? "✅ OP Watch tourne normalement"
    : `⚠️ OP Watch tourne avec ${incidents.length} incident${incidents.length > 1 ? "s" : ""}`;

  const incidentText = incidents.length === 0
    ? "Aucun incident sur ce cycle."
    : incidents.slice(0, 8).map((store) => `${store.store}: ${store.status}${store.error ? ` — ${store.error}` : ""}`).join("\n");

  return {
    username: "OP Watch",
    embeds: [{
      title,
      url: "https://op-watch-tcg-fr.pages.dev/",
      description: "Heartbeat automatique de production — envoyé toutes les 12 heures après un cycle réel du moteur.",
      fields: [
        { name: "🟢 Runtime", value: "LIVE", inline: true },
        { name: "⏱️ Cycle", value: cycle.discovery ? "Discovery + Fast Watch" : "Fast Watch", inline: true },
        { name: "✅ Boutiques OK", value: String(completed), inline: true },
        { name: "🟠 En attente partenaire", value: String(cycle.pendingAuthorizedFeedStores.length), inline: true },
        { name: "⚠️ Incidents", value: String(incidents.length), inline: true },
        { name: "🕒 Contrôle", value: parisDate(checkedAt), inline: true },
        { name: "Détail", value: incidentText, inline: false }
      ],
      footer: { text: "OP Watch • heartbeat production 12h" },
      timestamp: checkedAt
    }]
  };
}

export async function dispatchRuntimeHeartbeat(
  cycle: DurableCycleResult,
  env: RuntimeEnv,
  force = false
): Promise<{ attempted: number; sent: number; errors: string[] }> {
  if (!force && !isHeartbeatTick(cycle.scheduledTime)) return { attempted: 0, sent: 0, errors: [] };
  const result = await dispatchDiscordPayloads([buildRuntimeHeartbeatPayload(cycle)], env);
  return { attempted: result.attempted, sent: result.sent, errors: result.errors };
}
