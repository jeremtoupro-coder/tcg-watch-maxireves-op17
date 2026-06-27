import { evaluateAlertRules } from "./alerts";
import { WATCH_CONFIG } from "./config";
import { buildDiscordPayloads, dispatchDiscordPayloads } from "./discord";
import { createStateStore, processCandidates, type StateStore } from "./state";
import type { Env, ProductCandidate, WatchConfig } from "./types";

export async function evaluateCandidates(
  candidates: ProductCandidate[],
  env: Env,
  options: {
    config?: WatchConfig;
    stateStore?: StateStore;
    now?: string;
  } = {}
): Promise<{
  configVersion: number;
  state: {
    mode: StateStore["mode"];
    writable: boolean;
    requestedWrite: boolean;
    writes: number;
    baselineCompleteBefore: boolean;
    baselineMarkedComplete: boolean;
  };
  uniqueCandidates: number;
  snapshots: Awaited<ReturnType<typeof processCandidates>>["snapshots"];
  changes: Awaited<ReturnType<typeof processCandidates>>["changes"];
  alertMatches: ReturnType<typeof evaluateAlertRules>;
  discordPayloads: ReturnType<typeof buildDiscordPayloads>;
  discordDispatch: Awaited<ReturnType<typeof dispatchDiscordPayloads>>;
}> {
  const config = options.config ?? WATCH_CONFIG;
  const stateStore = options.stateStore ?? createStateStore(env);
  const requestedWrite = env.WRITE_STATE === "true";
  const baselineKey = `baseline:config-v${config.version}`;
  const baselineCompleteBefore = (await stateStore.getMetadata(baselineKey)) === "complete";

  const processed = await processCandidates(candidates, stateStore, {
    writeState: requestedWrite,
    now: options.now,
    initialBaseline: !baselineCompleteBefore
  });

  let baselineMarkedComplete = false;
  if (requestedWrite && stateStore.writable && !baselineCompleteBefore) {
    await stateStore.putMetadata(baselineKey, "complete");
    baselineMarkedComplete = true;
  }

  const alertMatches = evaluateAlertRules(processed.changes, config);
  const discordPayloads = buildDiscordPayloads(alertMatches);
  const discordDispatch = await dispatchDiscordPayloads(discordPayloads, env);

  return {
    configVersion: config.version,
    state: {
      mode: stateStore.mode,
      writable: stateStore.writable,
      requestedWrite,
      writes: processed.stateWrites,
      baselineCompleteBefore,
      baselineMarkedComplete
    },
    uniqueCandidates: processed.uniqueCandidates,
    snapshots: processed.snapshots,
    changes: processed.changes,
    alertMatches,
    discordPayloads,
    discordDispatch
  };
}
