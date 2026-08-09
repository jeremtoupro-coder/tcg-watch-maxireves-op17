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

/**
 * Un cron Cloudflare est déclenché chaque minute. Un cycle contrôle toutes les
 * boutiques actives. Une boutique dégradée est isolée : elle ne peut ni bloquer
 * les boutiques saines ni modifier son propre état persistant pendant le cycle.
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
  healthyStores?: StoreKey[];
  degradedStores?: Array<{ store: StoreKey; errors: string[] }>;
  reason?: string;
  audits?: Awaited<ReturnType<typeof auditConnector>>[];
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
  const connectors = selectConnectors(activeStores);

  if (connectors.length === 0) {
    return {
      status: "disabled",
      reason: "Aucune boutique active."
    };
  }

  const audits = await Promise.all(connectors.map((connector) => auditConnector(connector)));
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

  // Un candidat non éligible reste visible dans les audits/diagnostics mais ne
  // touche jamais l'état commercial. C'est notamment le cas d'une marketplace
  // dont le vendeur officiel n'a pas été confirmé sur la fiche directe.
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
    healthyStores,
    degradedStores,
    audits,
    evaluation
  };
}
