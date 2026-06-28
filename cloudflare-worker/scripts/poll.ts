import { auditConnector } from "../src/audit";
import { createConfiguredConnector } from "../src/connectorBuilder";
import { processProducts } from "../src/engine";
import { createRemoteState } from "../src/persistence";
import { getEnabledStoreDefinitions } from "../src/storeConfig";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";

export const POLL_VERSION = accountId ? 1 : 0;
