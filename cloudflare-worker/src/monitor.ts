import {
  DEFAULT_CLOUDFLARE_STORES,
  isStoreKey,
  selectConnectors
} from "./connectors";
import { evaluateCandidates } from "./engine";
import { auditStore, hasConfiguredAuthorizedFeed } from "./storeAudit";
import type { Env, StoreAudit, StoreKey } from "./types";

const DISCOVERY_INTERVAL_MINUTES = 15;

export function parseActiveStores(rawValue?: string): StoreKey[] {
  if (!rawValue?.trim()) return [...DEFAULT_CLOUDFLARE_STORES];

  const stores = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(isStoreKey);

  return [...new Set(stores)];
}

export function isDiscoveryTick(scheduledTime?: number): boolean {
  if (scheduledTime === undefined) return false;
  const minuteBucket = Math.floor(scheduledTime / 60_000);
  return minuteBucket % DISCOVERY_INTERVAL_MINUTES === 0;
}

/**
 * Un cron Cloudflare est déclenché chaque minute. Les boutiques commerciales
 * saines sont contrôlées en Fast Watch. Les boutiques discovery-only passent
 * toutes les 15 minutes. Une origine anti-bot connue n'est plus martelée si
 * son flux partenaire autorisé n'a pas encore été configuré.
 */
export async function runMonitoringCycle(
  env: Env,
  options: {
    scheduledTime?: number;
    forceStore?: StoreKey;
  } = {}
): Promise<{
  status: "disabled" | "completed";
  stores?: StoreKey[];
  deferredDiscoveryStores?: StoreKey[];
  pendingAuthorizedFeedStores?: StoreKey[];
  healthyStores?: StoreKey[];
  degradedStores?: Array<{ store: StoreKey; errors: string[] }>;
  reason?: string;
  audits?: StoreAudit[];
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

  const activeStores = options.forceStore
    ? [options.forceStore]
    : parseActiveStores(env.ACTIVE_STORES);
  const requestedConnectors = selectConnectors(activeStores);

  if (requestedConnectors.length === 0) {
    return {
      status: "disabled",
      reason: "Aucune boutique active."
    };
  }

  const includeDiscoveryOnly = Boolean(options.forceStore) || isDiscoveryTick(options.scheduledTime);
  const afterDiscoveryCadence = requestedConnectors.filter((connector) =>
    connector.commercialAlertsEnabled !== false || includeDiscoveryOnly
  );
  const deferredDiscoveryStores = requestedConnectors
    .filter((connector) => connector.commercialAlertsEnabled === false && !includeDiscoveryOnly)
    .map((connector) => connector.key);

  const pendingAuthorizedFeedStores = options.forceStore
    ? []
    : afterDiscoveryCadence
        .filter((connector) =>
          connector.directPollingDisabledWithoutFeed === true &&
          !hasConfiguredAuthorizedFeed(connector, env)
        )
        .map((connector) => connector.key);
  const pendingFeedKeys = new Set(pendingAuthorizedFeedStores);
  const connectors = afterDiscoveryCadence.filter((connector) => !pendingFeedKeys.has(connector.key));

  if (connectors.length === 0) {
    return {
      status: "completed",
      stores: [],
      deferredDiscoveryStores,
      pendingAuthorizedFeedStores,
      healthyStores: [],
      degradedStores: [],
      audits: [],
      evaluation: await evaluateCandidates([], env, { baselineStores: [] })
    };
  }

  const audits = await Promise.all(connectors.map((connector) => auditStore(connector, env)));
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const degradedStores = audits
    .map((audit) => ({
      store: audit.store,
      errors: audit.sources.filter((source) => source.error).map((source) => source.error as string)
    }))
    .filter((entry) => entry.errors.length > 0);
  const degradedKeys = new Set(degradedStores.map((entry) => entry.store));
  const healthyAudits = audits.filter((audit) => !degradedKeys.has(audit.store));
  const healthyStores = healthyAudits.map((audit) => audit.store);

  const candidates = healthyAudits.flatMap((audit) => {
    const connector = connectorByKey.get(audit.store);
    if (connector?.commercialAlertsEnabled === false) return [];
    return audit.candidates.filter((candidate) => candidate.commercialEligible !== false);
  });

  const baselineStores = healthyStores.filter((store) =>
    connectorByKey.get(store)?.commercialAlertsEnabled !== false
  );

  const evaluation = await evaluateCandidates(candidates, env, { baselineStores });

  return {
    status: "completed",
    stores: connectors.map((connector) => connector.key),
    deferredDiscoveryStores,
    pendingAuthorizedFeedStores,
    healthyStores,
    degradedStores,
    audits,
    evaluation
  };
}
