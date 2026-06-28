import { auditConnector } from "./audit";
import { processProducts } from "./engine";
import type { StateStore } from "./state";
import type { ConnectorDefinition } from "./types";

export const RUN_CYCLE_VERSION = 1;
