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

export const POLL_VERSION = successfulAudits.length;
