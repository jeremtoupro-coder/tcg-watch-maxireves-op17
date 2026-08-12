import { dispatchDiscordPayloads } from "./discord";
import type { DurableCycleResult, RuntimeEnv } from "./durableMonitoring";
import type { DiscordPayload } from "./types";

export const HEARTBEAT_PARIS_HOURS = new Set([10, 22]);
const HEARTBEAT_DISCORD_MAX_ATTEMPTS = 2;
const HEARTBEAT_RETRY_DELAY_MS = 1_500;

export function isHeartbeatTick(scheduledTime: number): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(scheduledTime));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return HEARTBEAT_PARIS_HOURS.has(hour) && minute === 0;
}

function parisDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris"
  }).format(new Date(iso));
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 900);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchHeartbeatPayload(
  payload: DiscordPayload,
  env: RuntimeEnv
): Promise<{ attempted: number; sent: number; errors: string[] }> {
  const maxAttempts = env.DISCORD_MODE === "live" ? HEARTBEAT_DISCORD_MAX_ATTEMPTS : 1;
  let attempted = 0;
  let sent = 0;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await dispatchDiscordPayloads([payload], env);
    attempted += result.attempted;
    sent += result.sent;
    errors.push(...result.errors.map((error) => `tentative ${attempt}: ${error}`));
    if (result.sent > 0) break;
    if (attempt < maxAttempts) await delay(HEARTBEAT_RETRY_DELAY_MS);
  }

  return { attempted, sent, errors };
}

export function buildRuntimeHeartbeatSignalPayload(scheduledTime: number): DiscordPayload {
  const checkedAt = new Date(scheduledTime).toISOString();
  return {
    username: "OP Watch",
    embeds: [{
      title: "💓 OP Watch LIVE — heartbeat reçu",
      url: "https://op-watch-tcg-fr.pages.dev/cockpit/",
      description: "Le scheduler de production a bien déclenché le heartbeat 10h/22h. Ce message est volontairement envoyé AVANT le cycle marchand afin qu'un scan lent ou bloqué ne puisse plus supprimer le heartbeat.",
      fields: [
        { name: "🟢 Runtime", value: "LIVE", inline: true },
        { name: "⏰ Scheduler", value: "ACTIF", inline: true },
        { name: "🔎 Contrôle marchand", value: "LANCÉ APRÈS CE HEARTBEAT", inline: true },
        { name: "🕒 Déclenchement", value: parisDate(checkedAt), inline: false }
      ],
      footer: { text: "OP Watch • heartbeat production 10h/22h • pré-cycle" },
      timestamp: checkedAt
    }]
  };
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
      description: "Heartbeat détaillé de production après un cycle réel du moteur.",
      fields: [
        { name: "🟢 Runtime", value: "LIVE", inline: true },
        { name: "⏱️ Cycle", value: cycle.discovery ? "Discovery + Fast Watch" : "Fast Watch", inline: true },
        { name: "✅ Boutiques OK", value: String(completed), inline: true },
        { name: "🟠 En attente partenaire", value: String(cycle.pendingAuthorizedFeedStores.length), inline: true },
        { name: "⚠️ Incidents", value: String(incidents.length), inline: true },
        { name: "🕒 Contrôle", value: parisDate(checkedAt), inline: true },
        { name: "Détail", value: incidentText, inline: false }
      ],
      footer: { text: "OP Watch • heartbeat détaillé" },
      timestamp: checkedAt
    }]
  };
}

export function buildRuntimeHeartbeatFailurePayload(scheduledTime: number, error: unknown): DiscordPayload {
  const checkedAt = new Date(scheduledTime).toISOString();
  return {
    username: "OP Watch",
    embeds: [{
      title: "🚨 OP Watch — cycle de contrôle en échec",
      url: "https://op-watch-tcg-fr.pages.dev/cockpit/",
      description: "Le heartbeat pré-cycle a déjà été tenté à l'heure prévue, mais le moteur n'a pas pu terminer le cycle de supervision.",
      fields: [
        { name: "🟢 Runtime", value: "LIVE", inline: true },
        { name: "⏱️ Cycle", value: "ÉCHEC AVANT FIN DU CONTRÔLE", inline: true },
        { name: "🕒 Contrôle", value: parisDate(checkedAt), inline: true },
        { name: "Erreur", value: safeError(error) || "Erreur inconnue", inline: false }
      ],
      footer: { text: "OP Watch • contrôle production • fail-safe" },
      timestamp: checkedAt
    }]
  };
}

export async function dispatchRuntimeHeartbeatSignal(
  scheduledTime: number,
  env: RuntimeEnv,
  force = false
): Promise<{ attempted: number; sent: number; errors: string[] }> {
  if (!force && !isHeartbeatTick(scheduledTime)) return { attempted: 0, sent: 0, errors: [] };
  return dispatchHeartbeatPayload(buildRuntimeHeartbeatSignalPayload(scheduledTime), env);
}

export async function dispatchRuntimeHeartbeat(
  cycle: DurableCycleResult,
  env: RuntimeEnv,
  force = false
): Promise<{ attempted: number; sent: number; errors: string[] }> {
  if (!force && !isHeartbeatTick(cycle.scheduledTime)) return { attempted: 0, sent: 0, errors: [] };
  return dispatchHeartbeatPayload(buildRuntimeHeartbeatPayload(cycle), env);
}

export async function dispatchRuntimeHeartbeatFailure(
  scheduledTime: number,
  env: RuntimeEnv,
  error: unknown,
  force = false
): Promise<{ attempted: number; sent: number; errors: string[] }> {
  if (!force && !isHeartbeatTick(scheduledTime)) return { attempted: 0, sent: 0, errors: [] };
  return dispatchHeartbeatPayload(buildRuntimeHeartbeatFailurePayload(scheduledTime, error), env);
}
