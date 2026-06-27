import { auditConnector } from "./audit";
import {
  DEFAULT_CLOUDFLARE_STORES,
  isStoreKey,
  selectConnectors
} from "./connectors";
import { evaluateCandidates } from "./engine";
import type { Env, StoreKey } from "./types";

export function parseActiveStores(rawValue?: string): StoreKey[] {
  if (!rawValue?.trim()) return [...DEFAULT_CLOUDFLARE_STORES];

  const stores = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(isStoreKey);

  return [...new Set(stores)];
}

export function selectScheduledStore(
  stores: StoreKey[],
  scheduledTime: number
): StoreKey | undefined {
  if (stores.length === 0) return undefined;
  const minute = Math.floor(scheduledTime / 60_000);
  return stores[minute % stores.length];
}

export async function runMonitoringCycle(
  env: Env,
  options: {
    scheduledTime?: number;
    forceStore?: StoreKey;
  } = {}
): Promise<{
  status: "disabled" | "completed";
  store?: StoreKey;
  reason?: string;
  audit?: Awaited<ReturnType<typeof auditConnector>>;
  evaluation?: Awaited<ReturnType<typeof evaluateCandidates>>;
}> {
  if (env.MONITORING_ENABLED !== "true") {
    return {
      status: "disabled",
      reason: "MONITORING_ENABLED n'est pas activé."
    };
  }

  if (!env.TCG_STATE) {
    throw new Error("Le binding TCG_STATE est obligatoire pour la surveillance.");
  }

  if (env.WRITE_STATE !== "true") {
    throw new Error("WRITE_STATE doit être activé pour une surveillance persistante.");
  }

  const activeStores = parseActiveStores(env.ACTIVE_STORES);
  const store = options.forceStore ?? selectScheduledStore(
    activeStores,
    options.scheduledTime ?? Date.now()
  );

  if (!store) {
    return {
      status: "disabled",
      reason: "Aucune boutique active."
    };
  }

  const connector = selectConnectors([store])[0];
  if (!connector) throw new Error(`Connecteur introuvable pour ${store}.`);

  const audit = await auditConnector(connector);
  const failedSources = audit.sources.filter((source) => source.error);
  if (failedSources.length > 0) {
    throw new Error(
      `${connector.name}: ${failedSources.map((source) => source.error).join(", ")}`
    );
  }

  const evaluation = await evaluateCandidates(audit.candidates, env, {
    baselineStores: [store]
  });

  return {
    status: "completed",
    store,
    audit,
    evaluation
  };
}
