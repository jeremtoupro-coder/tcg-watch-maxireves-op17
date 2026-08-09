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
 * Un cron Cloudflare est déclenché chaque minute. Contrairement à l'ancien
 * round-robin, un cycle contrôle toutes les boutiques actives : une boutique
 * ne doit jamais attendre N minutes simplement parce que N boutiques sont
 * configurées. Chaque connecteur conserve sa propre limitation de concurrence.
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
  const failures = audits.flatMap((audit) =>
    audit.sources
      .filter((source) => source.error)
      .map((source) => `${audit.storeName}: ${source.error}`)
  );

  if (failures.length > 0) {
    // Fail closed: une source attendue en erreur ne doit jamais être considérée
    // comme une absence de stock. Le cycle est signalé en échec avant toute
    // baseline silencieuse qui pourrait effacer un état valide.
    throw new Error(`Surveillance dégradée: ${failures.join(" | ")}`);
  }

  const candidates = audits.flatMap((audit) => audit.candidates);
  const evaluation = await evaluateCandidates(candidates, env, {
    baselineStores: connectors.map((connector) => connector.key)
  });

  return {
    status: "completed",
    stores: connectors.map((connector) => connector.key),
    audits,
    evaluation
  };
}
