import { createRemoteState } from "../src/persistence";
import { runMonitoringCycle } from "../src/monitor";
import { writeJsonReport } from "../src/report";
import type { Env } from "../src/types";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE?.trim() || "tcg-watch-state";
const discordEndpoint = process.env.DISCORD_WEBHOOK_URL?.trim() ?? "";
const mode = process.env.MONITOR_MODE === "baseline" ? "baseline" : "live";

if (!accountId || !apiToken) throw new Error("Les identifiants Cloudflare sont absents.");
if (mode === "live" && !discordEndpoint) throw new Error("Le canal Discord est absent.");

const stateStore = await createRemoteState({ accountId, apiToken, namespaceTitle });
const env: Env = {
  MONITORING_ENABLED: "true",
  WRITE_STATE: "true",
  DISCORD_MODE: mode === "live" ? "live" : "dry-run",
  DISCORD_WEBHOOK_URL: discordEndpoint || undefined,
  ACTIVE_STORES: process.env.ACTIVE_STORES,
  AUTHORIZED_FEED_PLAYIN_URL: process.env.AUTHORIZED_FEED_PLAYIN_URL,
  AUTHORIZED_FEED_CULTURA_URL: process.env.AUTHORIZED_FEED_CULTURA_URL,
  AUTHORIZED_FEED_MICROMANIA_URL: process.env.AUTHORIZED_FEED_MICROMANIA_URL,
  AUTHORIZED_FEED_FNAC_URL: process.env.AUTHORIZED_FEED_FNAC_URL,
  AUTHORIZED_FEED_CARREFOUR_URL: process.env.AUTHORIZED_FEED_CARREFOUR_URL,
  AUTHORIZED_FEED_KING_JOUET_URL: process.env.AUTHORIZED_FEED_KING_JOUET_URL
};

const result = await runMonitoringCycle(env, {
  scheduledTime: Date.now(),
  stateStore
});
const checkedAt = new Date().toISOString();
const report = {
  mode,
  checkedAt,
  fastWatchTargetSeconds: 60,
  discoveryTargetSeconds: 900,
  ...result
};

if (
  result.status === "completed" &&
  (result.degradedStores?.length ?? 0) === 0 &&
  (result.evaluation?.discordDispatch.errors.length ?? 0) === 0
) {
  await stateStore.putMetadata("external-monitor:last-success", checkedAt);
}

await writeJsonReport("monitor-report.json", report);
console.log(JSON.stringify(report));

if ((result.evaluation?.discordDispatch.errors.length ?? 0) > 0) {
  process.exitCode = 1;
}

export const POLL_VERSION = result.evaluation?.configVersion ?? 3;
