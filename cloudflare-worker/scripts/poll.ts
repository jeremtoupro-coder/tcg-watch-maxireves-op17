import { auditConnector } from "../src/audit";
import { createConfiguredConnector } from "../src/connectorBuilder";
import { processProducts } from "../src/engine";
import { createRemoteState } from "../src/persistence";
import { getEnabledStoreDefinitions } from "../src/storeConfig";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE?.trim() || "tcg-watch-state";
const discordEndpoint = process.env.DISCORD_WEBHOOK_URL?.trim() ?? "";
const mode = process.env.MONITOR_MODE === "baseline" ? "baseline" : "live";

export const POLL_VERSION = accountId && apiToken ? 1 : 0;
