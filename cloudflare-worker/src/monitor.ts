import { auditConnector } from "./audit";
import {
  DEFAULT_CLOUDFLARE_STORES,
  isStoreKey,
  selectConnectors
} from "./connectors";
import { evaluateCandidates } from "./engine";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

const FANTASY_BATCH_SIZE = 2;

export interface MonitoringTask {
  store: StoreKey;
  connector: ConnectorDefinition;
  batchIndex: number;
  batchCount: number;
}

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

export function buildMonitoringTasks(stores: StoreKey[]): MonitoringTask[] {
  const tasks: MonitoringTask[] = [];

  for (const connector of selectConnectors(stores)) {
    const batchSize = connector.key === "fantasy-sphere"
      ? FANTASY_BATCH_SIZE
      : Math.max(1, connector.sources.length);
    const batchCount = Math.ceil(connector.sources.length / batchSize);

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const sources = connector.sources.slice(
        batchIndex * batchSize,
        (batchIndex + 1) * batchSize
      );

      tasks.push({
        store: connector.key,
        connector: { ...connector, sources },
        batchIndex,
        batchCount
      });
    }
  }

  return tasks;
}

export function selectScheduledTask(
  tasks: MonitoringTask[],
  scheduledTime: number
): MonitoringTask | undefined {
  if (tasks.length === 0) return undefined;
  const minute = Math.floor(scheduledTime / 60_000);
  return tasks[minute % tasks.length];
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
  batchIndex?: number;
  batchCount?: number;
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

  const activeStores = options.forceStore
    ? [options.forceStore]
    : parseActiveStores(env.ACTIVE_STORES);
  const tasks = buildMonitoringTasks(activeStores);
  const task = selectScheduledTask(tasks, options.scheduledTime ?? Date.now());

  if (!task) {
    return {
      status: "disabled",
      reason: "Aucune boutique active."
    };
  }

  const audit = await auditConnector(task.connector);
  const failedSources = audit.sources.filter((source) => source.error);
  if (failedSources.length > 0) {
    throw new Error(
      `${task.connector.name}: ${failedSources.map((source) => source.error).join(", ")}`
    );
  }

  const evaluation = await evaluateCandidates(audit.candidates, env, {
    baselineStores: [task.store]
  });

  return {
    status: "completed",
    store: task.store,
    batchIndex: task.batchIndex,
    batchCount: task.batchCount,
    audit,
    evaluation
  };
}
