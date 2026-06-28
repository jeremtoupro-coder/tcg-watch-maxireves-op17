import { auditConnector } from "./audit";
import { processProducts } from "./engine";
import type { StateStore } from "./state";
import type { ConnectorDefinition } from "./types";

export interface CycleStoreSummary {
  store: string;
  status: "completed" | "failed";
  sources?: number;
  failedSources?: number;
  candidates?: number;
  changes?: number;
  alertsMatched?: number;
  alertsSent?: number;
  duplicatesSuppressed?: number;
  error?: string;
}

export async function processConnectorCycle(
  connector: ConnectorDefinition,
  stateStore: StateStore,
  discordEndpoint: string
): Promise<CycleStoreSummary> {
  try {
    const audit = await auditConnector(connector);
    if (audit.sources.length === 0 || audit.sources.every((source) => Boolean(source.error))) {
      throw new Error("Toutes les sources ont échoué.");
    }

    const evaluation = await processProducts(
      audit.candidates,
      {
        WRITE_STATE: "true",
        DISCORD_MODE: "live",
        DISCORD_WEBHOOK_URL: discordEndpoint
      },
      { stateStore, baselineStores: [connector.key] }
    );

    if (evaluation.discordDispatch.errors.length > 0) {
      throw new Error(evaluation.discordDispatch.errors.join(", "));
    }

    return {
      store: connector.key,
      status: "completed",
      sources: audit.sources.length,
      failedSources: audit.sources.filter((source) => source.error).length,
      candidates: evaluation.uniqueCandidates,
      changes: evaluation.changes.length,
      alertsMatched: evaluation.alertMatches.length,
      alertsSent: evaluation.discordDispatch.sent,
      duplicatesSuppressed:
        evaluation.deliveryDedupe.suppressedByReceipt +
        evaluation.deliveryDedupe.suppressedByClaim
    };
  } catch (error) {
    return {
      store: connector.key,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
