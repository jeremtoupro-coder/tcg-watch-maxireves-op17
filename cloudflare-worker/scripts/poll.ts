import { auditConnector } from "../src/audit";
import { createConfiguredConnector } from "../src/connectorBuilder";
import { processProducts } from "../src/engine";
import { createRemoteState } from "../src/persistence";
import { getEnabledStoreDefinitions } from "../src/storeConfig";
import type { ConnectorDefinition } from "../src/types";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE?.trim() || "tcg-watch-state";
const discordEndpoint = process.env.DISCORD_WEBHOOK_URL?.trim() ?? "";
const mode = process.env.MONITOR_MODE === "baseline" ? "baseline" : "live";
const deliveryMode = mode === "live" ? "live" as const : "dry-run" as const;

if (!accountId || !apiToken) throw new Error("Les identifiants Cloudflare sont absents.");
if (mode === "live" && !discordEndpoint) throw new Error("Le canal Discord est absent.");

const stateStore = await createRemoteState({ accountId, apiToken, namespaceTitle });
const connectors: ConnectorDefinition[] = [];
for (const store of getEnabledStoreDefinitions()) {
  connectors.push(await createConfiguredConnector(store));
}

const audits = [];
for (const connector of connectors) {
  audits.push(await auditConnector(connector));
}

const successfulAudits = audits.filter(
  (audit) => audit.sources.some((source) => !source.error)
);
const candidates = successfulAudits.flatMap((audit) => audit.candidates);
const checkedStores = successfulAudits.map((audit) => audit.store);

const evaluation = await processProducts(
  candidates,
  {
    WRITE_STATE: "true",
    DISCORD_MODE: deliveryMode,
    DISCORD_WEBHOOK_URL: discordEndpoint
  },
  {
    stateStore,
    baselineStores: checkedStores
  }
);

const failedStores = audits
  .filter((audit) => audit.sources.every((source) => Boolean(source.error)))
  .map((audit) => audit.store);
const checkedAt = new Date().toISOString();
const report = {
  mode,
  checkedAt,
  intervalTargetMinutes: 5,
  configuredStores: connectors.length,
  checkedStores,
  failedStores,
  sourceCount: audits.reduce((total, audit) => total + audit.sources.length, 0),
  candidates: evaluation.uniqueCandidates,
  changes: evaluation.changes.length,
  alertsMatched: evaluation.alertMatches.length,
  alertsSent: evaluation.discordDispatch.sent,
  deliveryErrors: evaluation.discordDispatch.errors
};

if (failedStores.length === 0 && evaluation.discordDispatch.errors.length === 0) {
  await stateStore.putMetadata("external-monitor:last-success", checkedAt);
}

console.log(JSON.stringify(report));
if (failedStores.length > 0 || evaluation.discordDispatch.errors.length > 0) {
  process.exitCode = 1;
}

export const POLL_VERSION = evaluation.configVersion;
