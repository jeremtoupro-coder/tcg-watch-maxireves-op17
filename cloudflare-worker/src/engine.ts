import { evaluateAlertRules } from "./alerts";
import { WATCH_CONFIG } from "./config";
import { deliverAlertMatches } from "./delivery";
import { createStateStore, processCandidates, type StateStore } from "./state";
import type { Env, ProductCandidate, StoreKey, WatchConfig } from "./types";

export async function evaluateCandidates(
  candidates: ProductCandidate[],
  env: Env,
  options: {
    config?: WatchConfig;
    stateStore?: StateStore;
    now?: string;
    baselineStores?: StoreKey[];
    claimSettleMs?: number;
  } = {}
): Promise<{
  configVersion: number;
  state: {
    mode: StateStore["mode"];
    writable: boolean;
    requestedWrite: boolean;
    writes: number;
    baselines: Record<string, {
      completeBefore: boolean;
      markedComplete: boolean;
    }>;
  };
  uniqueCandidates: number;
  snapshots: Awaited<ReturnType<typeof processCandidates>>["snapshots"];
  changes: Awaited<ReturnType<typeof processCandidates>>["changes"];
  alertMatches: ReturnType<typeof evaluateAlertRules>;
  discordPayloads: Awaited<ReturnType<typeof deliverAlertMatches>>["payloads"];
  discordDispatch: Awaited<ReturnType<typeof deliverAlertMatches>>["dispatch"];
  deliveryDedupe: Awaited<ReturnType<typeof deliverAlertMatches>>["dedupe"];
}> {
  const config = options.config ?? WATCH_CONFIG;
  const stateStore = options.stateStore ?? createStateStore(env);
  const requestedWrite = env.WRITE_STATE === "true";
  const baselineStores = options.baselineStores ?? [...new Set(candidates.map((candidate) => candidate.store))];
  const baselines: Record<string, { completeBefore: boolean; markedComplete: boolean }> = {};
  const initialBaselineByStore: Partial<Record<StoreKey, boolean>> = {};

  for (const store of baselineStores) {
    const baselineKey = `baseline:config-v${config.version}:${store}`;
    const completeBefore = (await stateStore.getMetadata(baselineKey)) === "complete";
    baselines[store] = { completeBefore, markedComplete: false };
    initialBaselineByStore[store] = !completeBefore;
  }

  const processed = await processCandidates(candidates, stateStore, {
    writeState: requestedWrite,
    now: options.now,
    initialBaselineByStore
  });

  if (requestedWrite && stateStore.writable) {
    for (const store of baselineStores) {
      if (baselines[store].completeBefore) continue;
      const baselineKey = `baseline:config-v${config.version}:${store}`;
      await stateStore.putMetadata(baselineKey, "complete");
      baselines[store].markedComplete = true;
    }
  }

  const alertMatches = evaluateAlertRules(processed.changes, config);
  const delivery = await deliverAlertMatches(alertMatches, env, stateStore, {
    claimSettleMs: options.claimSettleMs,
    now: options.now
  });

  return {
    configVersion: config.version,
    state: {
      mode: stateStore.mode,
      writable: stateStore.writable,
      requestedWrite,
      writes: processed.stateWrites,
      baselines
    },
    uniqueCandidates: processed.uniqueCandidates,
    snapshots: processed.snapshots,
    changes: processed.changes,
    alertMatches,
    discordPayloads: delivery.payloads,
    discordDispatch: delivery.dispatch,
    deliveryDedupe: delivery.dedupe
  };
}

export const processProducts = evaluateCandidates;
