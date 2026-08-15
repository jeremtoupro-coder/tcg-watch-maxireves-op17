import { CONNECTORS } from "./connectors";
import { configuredStoreStatus } from "./storeAudit";
import {
  isDiscoveryTick,
  parseActiveStores,
  runMonitoringCycle,
  type MonitoringCircuitAnalysis
} from "./monitor";
import type { OfficialProduct } from "./opwatchV1";
import { loadOfficialCalendar } from "./officialCalendar";
import { handleSchedulerHealthRequest, handleSchedulerWatchdogAlarm } from "./schedulerHealth";
import { isWebScoutTick } from "./webScout";
import {
  dispatchRuntimeHeartbeatFailure,
  dispatchRuntimeHeartbeatSignal,
  isHeartbeatTick
} from "./heartbeat";
import { CONTROL_CONFIG_STORAGE_KEY, applyRuntimeControlConfig, defaultRuntimeControlConfig, extraStoreSources, normalizeRuntimeControlConfig, type RuntimeControlConfig } from "./controlPlane";
import type { StateStore } from "./state";
import type { Env, LanguageStatus, ProductSnapshot, StoreKey } from "./types";
import opWatchV1Config from "../config/opwatch-v1.json";

export const STORE_DO_BATCH_SIZE = 6;
export const DURABLE_MEMORY_GB_CONSERVATIVE = 0.128;
export const DURABLE_FREE_GB_SECONDS_PER_DAY = 13_000;
export const DURABLE_TARGET_GB_SECONDS_PER_DAY = 9_000;
export const DURABLE_FREE_REQUESTS_PER_DAY = 100_000;
export const CADENCE_WINDOWS_PER_DAY = 96;
export const CADENCE_SAMPLE_CYCLES = 15;
const DEGRADED_BACKOFF_MS = 5 * 60_000;
const DISCOVERY_INTERVAL_MS = 15 * 60_000;

export interface RuntimeEnv extends Env {
  STORE_MONITORS?: DurableObjectNamespace;
  CALENDAR_COORDINATOR?: DurableObjectNamespace;
  WEB_SCOUT?: DurableObjectNamespace;
  SCHEDULER_MODE?: "disabled" | "live" | "test";
  CRON_CONFIGURED?: string;
  RUNTIME_TEST_MODE?: string;
  RUNTIME_TEST_RUN_ID?: string;
}

export interface CycleStoreSelection {
  discovery: boolean;
  stores: StoreKey[];
  pendingAuthorizedFeedStores: StoreKey[];
  deferredDiscoveryStores: StoreKey[];
}

export interface DurableCycleStoreResult {
  store: StoreKey;
  status: "completed" | "degraded" | "backoff" | "overlap" | "error";
  durationMs: number;
  merchantDurationMs: number;
  backoffUntil?: string;
  result?: Awaited<ReturnType<typeof runMonitoringCycle>>;
  error?: string;
}

export interface StoreRuntimeHealth {
  store: StoreKey;
  status: DurableCycleStoreResult["status"];
  checkedAt: string;
  completedAt: string;
  durationMs: number;
  merchantDurationMs: number;
  candidates: number;
  merchantSources: number;
  successfulMerchantSources: number;
  lastMerchantCheckAt?: string;
  lastDiscoveryAt?: string;
  lastFastWatchAt?: string;
  deferredFastWatch: boolean;
  analysis?: {
    newReleases: MonitoringCircuitAnalysis;
    onePieceAll: MonitoringCircuitAnalysis;
  };
  warnings?: string[];
  sourceKind?: string;
  sourceChecks?: Array<{
    source: string;
    status?: number;
    responseBytes?: number;
    cacheValidation?: "etag" | "last-modified" | "etag+last-modified" | "none";
    notModified?: boolean;
    deferred?: boolean;
    error?: string;
  }>;
  error?: string;
  backoffUntil?: string;
  discovery: boolean;
}

export interface DurableCycleResult {
  mode: "test" | "live";
  scheduledTime: number;
  discovery: boolean;
  calendarDurationMs: number;
  storeDurationMs: number;
  durableDurationMs: number;
  /** Temps mural réellement attendu par le Scheduled Event (les durées DO sommées servent au budget). */
  wallDurationMs: number;
  durableRequestCount: number;
  stores: DurableCycleStoreResult[];
  pendingAuthorizedFeedStores: StoreKey[];
  deferredDiscoveryStores: StoreKey[];
}

export interface CadenceBudgetProjection {
  sampleCycles: number;
  sampleDurationMs: number;
  sampleDurableRequests: number;
  projectedGbSecondsPerDay: number;
  projectedDurableRequestsPerDay: number;
  targetGbSecondsPerDay: number;
  freeGbSecondsPerDay: number;
  freeRequestsPerDay: number;
  marginGbSeconds: number;
  marginPercent: number;
  pass: boolean;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

interface JsonResponseSnapshot {
  body: string;
  status: number;
}

function jsonSnapshot(data: unknown, status = 200): JsonResponseSnapshot {
  return { body: JSON.stringify(data), status };
}

function responseFromSnapshot(snapshot: JsonResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimePrefix(env: RuntimeEnv, mode: "test" | "live"): string {
  if (mode === "test") {
    const runId = env.RUNTIME_TEST_RUN_ID?.trim();
    if (!runId) throw new Error("RUNTIME_TEST_RUN_ID est obligatoire en environnement de cadence isolé.");
    return `test:${runId}`;
  }
  return "production";
}

function strictDiscordWebhook(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.port === "" &&
      !parsed.username &&
      !parsed.password &&
      (parsed.hostname === "discord.com" || parsed.hostname === "discordapp.com") &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(parsed.pathname) &&
      parsed.search === "" &&
      parsed.hash === "";
  } catch {
    return false;
  }
}

export function assertRuntimeReadiness(env: RuntimeEnv, mode: "test" | "live"): void {
  if (!env.STORE_MONITORS || !env.CALENDAR_COORDINATOR) {
    throw new Error("Les bindings Durable Objects STORE_MONITORS et CALENDAR_COORDINATOR sont obligatoires.");
  }
  if (env.MONITORING_ENABLED !== "true" || env.WRITE_STATE !== "true") {
    throw new Error("MONITORING_ENABLED=true et WRITE_STATE=true sont obligatoires pour le runtime persistant.");
  }

  if (mode === "test") {
    if (env.RUNTIME_TEST_MODE !== "true") throw new Error("RUNTIME_TEST_MODE doit être activé pour le test isolé.");
    if (env.SCHEDULER_MODE !== "disabled" && env.SCHEDULER_MODE !== "test") {
      throw new Error("Le scheduler du test isolé doit être désactivé ou explicitement en mode test.");
    }
    if (env.SCHEDULER_MODE === "test" && env.CRON_CONFIGURED !== "true") {
      throw new Error("Le scheduler isolé en mode test exige CRON_CONFIGURED=true.");
    }
    if (env.DISCORD_MODE !== "dry-run") throw new Error("Discord doit rester en dry-run pendant le test isolé.");
    runtimePrefix(env, mode);
    return;
  }

  if (env.SCHEDULER_MODE !== "live") throw new Error("SCHEDULER_MODE=live est requis pour le runtime LIVE.");
  if (env.DISCORD_MODE !== "live") throw new Error("DISCORD_MODE=live est requis pour le runtime LIVE.");
  if (!strictDiscordWebhook(env.DISCORD_WEBHOOK_URL)) {
    throw new Error("Le webhook Discord LIVE doit être un endpoint Discord officiel valide.");
  }

  const active = parseActiveStores(env.ACTIVE_STORES);
  if (active.length !== CONNECTORS.length || CONNECTORS.some((connector) => !active.includes(connector.key))) {
    throw new Error(`LIVE refusé : les ${CONNECTORS.length} boutiques doivent toutes être présentes.`);
  }
}

export function selectStoresForCycle(
  env: RuntimeEnv,
  options: { scheduledTime: number; forceDiscovery?: boolean; forceStore?: StoreKey } 
): CycleStoreSelection {
  const discovery = options.forceDiscovery === true || isDiscoveryTick(options.scheduledTime);
  const requested = options.forceStore
    ? CONNECTORS.filter((connector) => connector.key === options.forceStore)
    : CONNECTORS.filter((connector) => parseActiveStores(env.ACTIVE_STORES).includes(connector.key));

  const pendingAuthorizedFeedStores = requested
    .filter((connector) => configuredStoreStatus(connector, env) === "pending_authorized_feed")
    .map((connector) => connector.key);
  const deferredDiscoveryStores = discovery ? [] : requested
    .filter((connector) => configuredStoreStatus(connector, env) === "discovery_only")
    .map((connector) => connector.key);

  const blocked = new Set([...pendingAuthorizedFeedStores, ...deferredDiscoveryStores]);
  return {
    discovery,
    stores: requested.filter((connector) => !blocked.has(connector.key)).map((connector) => connector.key),
    pendingAuthorizedFeedStores,
    deferredDiscoveryStores
  };
}

export function projectCadenceBudget(cycles: Array<Pick<DurableCycleResult, "durableDurationMs" | "durableRequestCount">>): CadenceBudgetProjection {
  const sampleDurationMs = cycles.reduce((sum, cycle) => sum + Math.max(0, cycle.durableDurationMs), 0);
  const sampleDurableRequests = cycles.reduce((sum, cycle) => sum + Math.max(0, cycle.durableRequestCount), 0);
  const projectedGbSecondsPerDay = sampleDurationMs / 1000 * DURABLE_MEMORY_GB_CONSERVATIVE * CADENCE_WINDOWS_PER_DAY;
  const projectedDurableRequestsPerDay = sampleDurableRequests * CADENCE_WINDOWS_PER_DAY;
  const marginGbSeconds = DURABLE_FREE_GB_SECONDS_PER_DAY - projectedGbSecondsPerDay;
  const marginPercent = marginGbSeconds / DURABLE_FREE_GB_SECONDS_PER_DAY * 100;
  return {
    sampleCycles: cycles.length,
    sampleDurationMs,
    sampleDurableRequests,
    projectedGbSecondsPerDay,
    projectedDurableRequestsPerDay,
    targetGbSecondsPerDay: DURABLE_TARGET_GB_SECONDS_PER_DAY,
    freeGbSecondsPerDay: DURABLE_FREE_GB_SECONDS_PER_DAY,
    freeRequestsPerDay: DURABLE_FREE_REQUESTS_PER_DAY,
    marginGbSeconds,
    marginPercent,
    pass: cycles.length === CADENCE_SAMPLE_CYCLES &&
      projectedGbSecondsPerDay <= DURABLE_TARGET_GB_SECONDS_PER_DAY &&
      projectedDurableRequestsPerDay < DURABLE_FREE_REQUESTS_PER_DAY
  };
}

/** État fortement cohérent, isolé à un Durable Object boutique/calendrier. */
export class DurableObjectStateStore {
  readonly writable: boolean;
  readonly mode = "memory" as const;

  constructor(private readonly storage: DurableObjectStorage, writable = true) {
    this.writable = writable;
  }

  async get(key: string): Promise<ProductSnapshot | undefined> {
    return await this.storage.get<ProductSnapshot>(`product:${key}`);
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    if (!this.writable) return;
    await this.storage.put(`product:${key}`, value);
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return await this.storage.get<string>(`metadata:${key}`);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    if (!this.writable) return;
    await this.storage.put(`metadata:${key}`, value);
  }
}

function asStateStore(store: DurableObjectStateStore): StateStore {
  return store;
}

function sourceDurationMs(result: Awaited<ReturnType<typeof runMonitoringCycle>>): number {
  return result.audits?.reduce(
    (total, audit) => total + audit.sources.reduce((sum, source) => sum + Math.max(0, source.durationMs), 0),
    0
  ) ?? 0;
}

async function invokeWebScout(env: RuntimeEnv, scheduledTime: number, label: string): Promise<void> {
  if (!env.WEB_SCOUT) throw new Error("Binding WEB_SCOUT absent.");
  if (!env.BRAVE_SEARCH_API_KEY?.trim()) throw new Error("BRAVE_SEARCH_API_KEY absent.");
  const stub = env.WEB_SCOUT.get(env.WEB_SCOUT.idFromName("production:web-scout"));
  const response = await stub.fetch(new Request("https://web-scout.internal/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime })
  }));
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  await response.body?.cancel().catch(() => undefined);
}

export class StoreMonitorDurableObject {
  private running = false;

  constructor(private readonly state: DurableObjectState, private readonly env: RuntimeEnv) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      return json({ health: await this.state.storage.get<StoreRuntimeHealth>("runtime:health") });
    }
    if (request.method === "POST" && pathname === "/invalidate") {
      await this.state.storage.put("metadata:monitor:last-discovery", "1970-01-01T00:00:00.000Z");
      return json({ status: "invalidated" });
    }
    if (request.method !== "POST" || pathname !== "/run") {
      return json({ error: "Route Durable Object boutique invalide." }, 404);
    }
    if (this.running) {
      return json({ status: "overlap", durationMs: 0, merchantDurationMs: 0 }, 409);
    }

    const started = performance.now();
    let activeStore: StoreKey | undefined;
    let activeScheduledTime = Date.now();
    let activeDiscovery = false;
    let previousHealth: StoreRuntimeHealth | undefined;
    this.running = true;
    try {
      const input = await request.json() as {
        store?: StoreKey;
        scheduledTime?: number;
        forceDiscovery?: boolean;
        officialProducts?: OfficialProduct[];
        officialCatalogProductIds?: string[];
        acceptedLanguages?: LanguageStatus[];
        extraStoreSources?: string[];
      };
      const store = input.store;
      activeStore = store;
      activeScheduledTime = Number(input.scheduledTime) || Date.now();
      activeDiscovery = input.forceDiscovery === true;
      const scheduledTime = input.scheduledTime;
      if (!store || !CONNECTORS.some((connector) => connector.key === store)) {
        return json({ error: "Boutique inconnue." }, 400);
      }
      if (!Number.isFinite(scheduledTime) || !Array.isArray(input.officialProducts)) {
        return json({ error: "Cycle boutique incomplet." }, 400);
      }

      const connector = CONNECTORS.find((entry) => entry.key === store)!;
      if (connector.maxConcurrency === undefined) connector.maxConcurrency = 2;
      previousHealth = await this.state.storage.get<StoreRuntimeHealth>("runtime:health");

      const stateStore = asStateStore(new DurableObjectStateStore(this.state.storage, this.env.WRITE_STATE === "true"));
      const backoffRaw = await stateStore.getMetadata("runtime:backoff-until");
      const backoffUntil = backoffRaw ? Date.parse(backoffRaw) : Number.NaN;
      if (Number.isFinite(backoffUntil) && (scheduledTime as number) < backoffUntil && input.forceDiscovery !== true) {
        const durationMs = Math.round(performance.now() - started);
        const health: StoreRuntimeHealth = {
          store,
          status: "backoff",
          checkedAt: new Date(scheduledTime as number).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          merchantDurationMs: 0,
          candidates: 0,
          merchantSources: 0,
          successfulMerchantSources: 0,
          ...(previousHealth?.lastMerchantCheckAt ? { lastMerchantCheckAt: previousHealth.lastMerchantCheckAt } : {}),
          ...(previousHealth?.lastDiscoveryAt ? { lastDiscoveryAt: previousHealth.lastDiscoveryAt } : {}),
          ...(previousHealth?.lastFastWatchAt ? { lastFastWatchAt: previousHealth.lastFastWatchAt } : {}),
          deferredFastWatch: previousHealth?.deferredFastWatch ?? false,
          ...(previousHealth?.analysis ? { analysis: previousHealth.analysis } : {}),
          ...(previousHealth?.sourceChecks ? { sourceChecks: previousHealth.sourceChecks } : {}),
          backoffUntil: new Date(backoffUntil).toISOString(),
          discovery: false
        };
        await this.state.storage.put("runtime:health", health);
        return json({ status: "backoff", durationMs, merchantDurationMs: 0, backoffUntil: health.backoffUntil });
      }

      const storeEnv: RuntimeEnv = { ...this.env, ACTIVE_STORES: store };
      const acceptedLanguages = input.acceptedLanguages?.length ? input.acceptedLanguages : ["Français confirmé" as LanguageStatus];
      const result = await runMonitoringCycle(storeEnv, {
        scheduledTime: scheduledTime as number,
        officialProducts: input.officialProducts,
        officialCatalogProductIds: input.officialCatalogProductIds,
        acceptedLanguages,
        extraSourcesByStore: input.extraStoreSources?.length ? { [store]: input.extraStoreSources } : undefined,
        stateStore,
        now: new Date(scheduledTime as number),
        forceDiscovery: input.forceDiscovery === true
      });

      const degraded = result.degradedStores?.some((entry) => entry.store === store) === true;
      if (degraded) {
        const until = new Date((scheduledTime as number) + DEGRADED_BACKOFF_MS).toISOString();
        if (backoffRaw !== until) await stateStore.putMetadata("runtime:backoff-until", until);
      } else if (backoffRaw && backoffRaw !== "1970-01-01T00:00:00.000Z") {
        await stateStore.putMetadata("runtime:backoff-until", "1970-01-01T00:00:00.000Z");
      }

      const durationMs = Math.round(performance.now() - started);
      const merchantDurationMs = sourceDurationMs(result);
      const audit = result.audits?.find((entry) => entry.store === store);
      const merchantSources = audit?.sources.length ?? 0;
      const successfulMerchantSources = audit?.sources.filter((source) => !source.error && !source.deferred).length ?? 0;
      const successfulMerchantCheck = successfulMerchantSources > 0;
      const checkedAt = new Date(scheduledTime as number).toISOString();
      const deferredFastWatch = result.deferredFastWatchStores?.includes(store) === true ||
        (audit?.sources.length ? audit.sources.every((source) => source.deferred === true) : false);
      const error = result.degradedStores?.find((entry) => entry.store === store)?.errors.join(" | ");
      const sourceChecks = audit?.sources.map((source) => ({
        source: source.sourceUrl,
        ...(source.status !== undefined ? { status: source.status } : {}),
        ...(source.responseBytes !== undefined ? { responseBytes: source.responseBytes } : {}),
        ...(source.cacheValidation ? { cacheValidation: source.cacheValidation } : {}),
        ...(source.notModified ? { notModified: true } : {}),
        ...(source.deferred ? { deferred: true } : {}),
        ...(source.error ? { error: source.error } : {})
      })) ?? [];
      const passiveAuthorizedFeed = sourceChecks.length > 0 && sourceChecks.every((source) =>
        source.notModified === true || source.deferred === true
      );
      const health: StoreRuntimeHealth = {
        store,
        status: degraded ? "degraded" : "completed",
        checkedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        merchantDurationMs,
        candidates: passiveAuthorizedFeed ? previousHealth?.candidates ?? 0 : audit?.candidates.length ?? 0,
        merchantSources,
        successfulMerchantSources,
        ...(successfulMerchantCheck
          ? { lastMerchantCheckAt: checkedAt }
          : previousHealth?.lastMerchantCheckAt
            ? { lastMerchantCheckAt: previousHealth.lastMerchantCheckAt }
            : {}),
        ...(input.forceDiscovery === true && successfulMerchantCheck
          ? { lastDiscoveryAt: checkedAt }
          : previousHealth?.lastDiscoveryAt
            ? { lastDiscoveryAt: previousHealth.lastDiscoveryAt }
            : {}),
        ...(input.forceDiscovery !== true && successfulMerchantCheck
          ? { lastFastWatchAt: checkedAt }
          : previousHealth?.lastFastWatchAt
            ? { lastFastWatchAt: previousHealth.lastFastWatchAt }
            : {}),
        deferredFastWatch,
        ...(passiveAuthorizedFeed && previousHealth?.analysis
          ? { analysis: previousHealth.analysis }
          : audit && result.analysis
          ? { analysis: result.analysis }
          : previousHealth?.analysis
            ? { analysis: previousHealth.analysis }
            : {}),
        ...(audit?.warnings?.length ? { warnings: audit.warnings.slice(0, 8) } : {}),
        sourceKind: audit?.sourceKind ?? previousHealth?.sourceKind,
        ...(sourceChecks.length ? { sourceChecks } : previousHealth?.sourceChecks ? { sourceChecks: previousHealth.sourceChecks } : {}),
        ...(error ? { error } : {}),
        discovery: input.forceDiscovery === true
      };
      await this.state.storage.put("runtime:health", health);
      return json({ status: health.status, durationMs, merchantDurationMs, result });
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      const message = safeError(error);
      if (activeStore) {
        await this.state.storage.put("runtime:health", {
          store: activeStore,
          status: "error",
          checkedAt: new Date(activeScheduledTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          merchantDurationMs: 0,
          candidates: 0,
          merchantSources: 0,
          successfulMerchantSources: 0,
          ...(previousHealth?.lastMerchantCheckAt ? { lastMerchantCheckAt: previousHealth.lastMerchantCheckAt } : {}),
          ...(previousHealth?.lastDiscoveryAt ? { lastDiscoveryAt: previousHealth.lastDiscoveryAt } : {}),
          ...(previousHealth?.lastFastWatchAt ? { lastFastWatchAt: previousHealth.lastFastWatchAt } : {}),
          deferredFastWatch: previousHealth?.deferredFastWatch ?? false,
          ...(previousHealth?.analysis ? { analysis: previousHealth.analysis } : {}),
          ...(previousHealth?.sourceChecks ? { sourceChecks: previousHealth.sourceChecks } : {}),
          error: message,
          discovery: activeDiscovery
        } satisfies StoreRuntimeHealth);
      }
      return json({ status: "error", durationMs, merchantDurationMs: 0, error: message }, 500);
    } finally {
      this.running = false;
    }
  }
}

export class CalendarCoordinatorDurableObject {
  /**
   * Une seule lecture Bandai est exécutée à la fois, mais chaque appelant doit
   * recevoir son propre corps HTTP. Une Response est un stream mono-lecture :
   * la partager entre le cron et le cockpit provoquait aléatoirement
   * "Body has already been used" chez le second consommateur.
  */
  private running?: Promise<JsonResponseSnapshot>;
  private scheduledMonitoringRunning = false;

  constructor(private readonly state: DurableObjectState, private readonly env: RuntimeEnv) {}

  private async schedulerMark(input: Record<string, unknown>): Promise<void> {
    try {
      const response = await handleSchedulerHealthRequest(new Request("https://scheduler-health.internal/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }), this.state.storage, this.env);
      if (!response?.ok) throw new Error(`Scheduler mark HTTP ${response?.status ?? 500}`);
    } catch (error) {
      console.error("Scheduler coordinator mark failed:", safeError(error));
    }
  }

  private async runDeliveredWebScout(scheduledTime: number): Promise<void> {
    if (!isWebScoutTick(scheduledTime)) return;
    const started = performance.now();
    await this.schedulerMark({ kind: "web_scout_started", scheduledTime });
    try {
      await invokeWebScout(this.env, scheduledTime, "Web Scout");
      await this.schedulerMark({
        kind: "web_scout_completed",
        scheduledTime,
        durationMs: performance.now() - started
      });
    } catch (error) {
      const message = safeError(error);
      await this.schedulerMark({
        kind: "web_scout_failed",
        scheduledTime,
        durationMs: performance.now() - started,
        error: message
      });
      console.error("Web Scout error:", message);
    }
  }

  /**
   * Le Cron Free dispose de 10 ms de CPU. Toute l'orchestration et la lecture
   * des réponses boutiques sont donc déportées dans ce Durable Object (30 s
   * de CPU par requête), tandis que le Scheduled Handler ne fait qu'un appel
   * de binding. Le heartbeat reste strictement antérieur au cycle marchand.
   */
  private async runDeliveredScheduledEvent(request: Request): Promise<Response> {
    const input = await request.json() as { scheduledTime?: number; mode?: "test" | "live" };
    const scheduledTime = Number(input.scheduledTime);
    const mode = input.mode;
    if (!Number.isFinite(scheduledTime) || (mode !== "test" && mode !== "live")) {
      return json({ error: "Scheduled Event interne invalide." }, 400);
    }
    const isolatedSchedulerTest = mode === "test" &&
      this.env.SCHEDULER_MODE === "test" &&
      this.env.RUNTIME_TEST_MODE === "true" &&
      this.env.DISCORD_MODE === "dry-run" &&
      Boolean(this.env.RUNTIME_TEST_RUN_ID?.trim());
    if ((mode === "live" && this.env.SCHEDULER_MODE !== "live") || (mode === "test" && !isolatedSchedulerTest)) {
      return json({ error: "Scheduled Event interne refusé par les garde-fous runtime." }, 403);
    }

    const discovery = isDiscoveryTick(scheduledTime);
    const heartbeatTick = mode === "live" && isHeartbeatTick(scheduledTime);
    await this.schedulerMark({
      kind: "scheduled_received",
      scheduledTime,
      observedTime: Date.now()
    });

    if (heartbeatTick) {
      await this.schedulerMark({ kind: "automatic_heartbeat_started", scheduledTime });
      try {
        const delivery = await dispatchRuntimeHeartbeatSignal(scheduledTime, this.env);
        if (delivery.sent !== 1) {
          const error = delivery.errors.join(" | ") || "Discord n'a confirmé aucun envoi.";
          await this.schedulerMark({ kind: "automatic_heartbeat_failed", scheduledTime, error });
          console.error("Scheduled pre-cycle heartbeat delivery failed:", JSON.stringify(delivery));
        } else {
          await this.schedulerMark({ kind: "automatic_heartbeat_completed", scheduledTime });
        }
      } catch (error) {
        await this.schedulerMark({ kind: "automatic_heartbeat_failed", scheduledTime, error: safeError(error) });
        console.error("Scheduled pre-cycle heartbeat crashed:", safeError(error));
      }
    }

    if (this.scheduledMonitoringRunning) {
      await this.schedulerMark({
        kind: "monitoring_failed",
        scheduledTime,
        discovery,
        error: "Cycle scheduler déjà en cours : tick enregistré sans double polling."
      });
      if (mode === "live") await this.runDeliveredWebScout(scheduledTime);
      return json({ status: "overlap", discovery }, 202);
    }

    this.scheduledMonitoringRunning = true;
    const started = performance.now();
    let responseStatus = 200;
    let responseBody: Record<string, unknown>;
    try {
      await this.schedulerMark({ kind: "monitoring_started", scheduledTime, discovery });
      try {
        const cycle = await runDistributedMonitoringCycle(this.env, { mode, scheduledTime });
        const completedStores = cycle.stores.filter((store) => store.status === "completed").length;
        const incidentStores = cycle.stores.filter((store) => store.status !== "completed").length;
        await this.schedulerMark({
          kind: "monitoring_completed",
          scheduledTime,
          discovery: cycle.discovery,
          durationMs: performance.now() - started,
          completedStores,
          incidentStores
        });
        responseBody = { status: "completed", discovery: cycle.discovery, completedStores, incidentStores };
      } catch (error) {
        const message = safeError(error);
        await this.schedulerMark({
          kind: "monitoring_failed",
          scheduledTime,
          discovery,
          durationMs: performance.now() - started,
          error: message
        });
        console.error("Scheduled monitoring cycle failed:", message);
        if (heartbeatTick) {
          try {
            const delivery = await dispatchRuntimeHeartbeatFailure(scheduledTime, this.env, error);
            if (delivery.sent !== 1) console.error("Scheduled fail-safe cycle alert delivery failed:", JSON.stringify(delivery));
          } catch (heartbeatError) {
            console.error("Scheduled fail-safe cycle alert crashed:", safeError(heartbeatError));
          }
        }
        responseStatus = 503;
        responseBody = { status: "error", error: message };
      }
    } finally {
      this.scheduledMonitoringRunning = false;
    }
    if (mode === "live") await this.runDeliveredWebScout(scheduledTime);
    return json(responseBody!, responseStatus);
  }

  async fetch(request: Request): Promise<Response> {
    const schedulerHealthResponse = await handleSchedulerHealthRequest(request, this.state.storage, this.env);
    if (schedulerHealthResponse) return schedulerHealthResponse;

    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/control") {
      const raw = await this.state.storage.get<unknown>(CONTROL_CONFIG_STORAGE_KEY);
      return json(normalizeRuntimeControlConfig(raw));
    }
    if (request.method === "PUT" && pathname === "/control") {
      const raw = await request.json();
      const config = normalizeRuntimeControlConfig(raw);
      await this.state.storage.put(CONTROL_CONFIG_STORAGE_KEY, config);
      return json(config);
    }
    if (request.method === "POST" && pathname === "/scheduled-event") {
      return this.runDeliveredScheduledEvent(request);
    }
    if (request.method !== "POST" || pathname !== "/calendar") {
      return json({ error: "Route Durable Object calendrier invalide." }, 404);
    }
    if (this.running) return responseFromSnapshot(await this.running);

    this.running = (async () => {
      const started = performance.now();
      try {
        const input = await request.json() as { scheduledTime?: number };
        const scheduledTime = Number(input.scheduledTime);
        if (!Number.isFinite(scheduledTime)) return jsonSnapshot({ error: "scheduledTime invalide." }, 400);
        const stateStore = asStateStore(new DurableObjectStateStore(this.state.storage, true));
        const calendar = await loadOfficialCalendar({
          sourceUrl: opWatchV1Config.officialCatalogUrl,
          now: new Date(scheduledTime),
          daysBefore: opWatchV1Config.watchWindow.daysBeforeRelease,
          daysAfter: opWatchV1Config.watchWindow.daysAfterRelease,
          stateStore
        });
        const rawControl = await this.state.storage.get<unknown>(CONTROL_CONFIG_STORAGE_KEY);
        const control = rawControl ? normalizeRuntimeControlConfig(rawControl) : defaultRuntimeControlConfig();
        const activeProducts = applyRuntimeControlConfig(calendar.activeProducts, control, new Date(scheduledTime));
        return jsonSnapshot({
          durationMs: Math.round(performance.now() - started),
          fetchedAt: calendar.fetchedAt,
          sourcePages: calendar.sourcePages,
          cache: calendar.cache,
          cacheAgeMs: calendar.cacheAgeMs,
          ...(calendar.warning ? { calendarWarning: calendar.warning } : {}),
          activeProducts,
          officialCatalogProductIds: calendar.catalogProducts.map((product) => product.id),
          acceptedLanguages: control.languages,
          extraSourcesByStore: extraStoreSources(control),
          controlUpdatedAt: control.updatedAt
        });
      } catch (error) {
        return jsonSnapshot({
          durationMs: Math.round(performance.now() - started),
          error: safeError(error)
        }, 502);
      }
    })();

    try {
      return responseFromSnapshot(await this.running);
    } finally {
      this.running = undefined;
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const watchdog = await handleSchedulerWatchdogAlarm(this.state.storage, this.env, now);
    if (!watchdog.stale || this.env.MONITORING_ENABLED !== "true" || this.env.WRITE_STATE !== "true") return;

    const scheduledTime = Math.floor(now / 60_000) * 60_000;
    const discovery = isDiscoveryTick(scheduledTime);
    const mark = async (input: Record<string, unknown>) => {
      await handleSchedulerHealthRequest(new Request("https://scheduler-health.internal/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledTime, ...input })
      }), this.state.storage, this.env);
    };

    if (this.scheduledMonitoringRunning) {
      await mark({
        kind: "fallback_monitoring_failed",
        discovery,
        error: "Cycle automatique déjà en cours : fallback différé sans double polling."
      });
      return;
    }
    this.scheduledMonitoringRunning = true;

    try {
      const started = performance.now();
      await mark({ kind: "fallback_monitoring_started", discovery });
      try {
        const cycle = await runDistributedMonitoringCycle(this.env, { mode: "live", scheduledTime });
        await mark({
          kind: "fallback_monitoring_completed",
          discovery: cycle.discovery,
          durationMs: performance.now() - started,
          completedStores: cycle.stores.filter((store) => store.status === "completed").length,
          incidentStores: cycle.stores.filter((store) => store.status !== "completed").length
        });
      } catch (error) {
        await mark({
          kind: "fallback_monitoring_failed",
          discovery,
          durationMs: performance.now() - started,
          error: safeError(error)
        });
      }

      if (isWebScoutTick(scheduledTime)) {
        const scoutStarted = performance.now();
        await mark({ kind: "fallback_web_scout_started" });
        try {
          await invokeWebScout(this.env, scheduledTime, "Web Scout fallback");
          await mark({ kind: "fallback_web_scout_completed", durationMs: performance.now() - scoutStarted });
        } catch (error) {
          await mark({
            kind: "fallback_web_scout_failed",
            durationMs: performance.now() - scoutStarted,
            error: safeError(error)
          });
        }
      }
    } finally {
      this.scheduledMonitoringRunning = false;
    }
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T;
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Durable Object HTTP ${response.status}`);
  return data;
}

async function getCalendar(
  env: RuntimeEnv,
  prefix: string,
  scheduledTime: number
): Promise<{
  durationMs: number;
  activeProducts: OfficialProduct[];
  officialCatalogProductIds: string[];
  acceptedLanguages: LanguageStatus[];
  extraSourcesByStore: Partial<Record<StoreKey, string[]>>;
}> {
  const id = env.CALENDAR_COORDINATOR!.idFromName(`${prefix}:calendar`);
  const stub = env.CALENDAR_COORDINATOR!.get(id);
  return await readJson(await stub.fetch(new Request("https://calendar.internal/calendar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime })
  })));
}

async function runStore(
  env: RuntimeEnv,
  prefix: string,
  store: StoreKey,
  scheduledTime: number,
  forceDiscovery: boolean,
  officialProducts: OfficialProduct[],
  officialCatalogProductIds: string[],
  acceptedLanguages: LanguageStatus[],
  extraStoreSources: string[]
): Promise<DurableCycleStoreResult> {
  const id = env.STORE_MONITORS!.idFromName(`${prefix}:store:${store}`);
  const stub = env.STORE_MONITORS!.get(id);
  try {
    const response = await stub.fetch(new Request("https://store.internal/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store,
        scheduledTime,
        forceDiscovery,
        officialProducts,
        officialCatalogProductIds,
        acceptedLanguages,
        extraStoreSources
      })
    }));
    const payload = await response.json() as Omit<DurableCycleStoreResult, "store">;
    return { store, ...payload };
  } catch (error) {
    return { store, status: "error", durationMs: 0, merchantDurationMs: 0, error: safeError(error) };
  }
}

export async function runDistributedMonitoringCycle(
  env: RuntimeEnv,
  options: {
    scheduledTime?: number;
    forceDiscovery?: boolean;
    forceStore?: StoreKey;
    mode: "test" | "live";
  }
): Promise<DurableCycleResult> {
  const wallStarted = performance.now();
  assertRuntimeReadiness(env, options.mode);
  const scheduledTime = options.scheduledTime ?? Date.now();
  const prefix = runtimePrefix(env, options.mode);
  const selection = selectStoresForCycle(env, {
    scheduledTime,
    forceDiscovery: options.forceDiscovery,
    forceStore: options.forceStore
  });

  const calendar = await getCalendar(env, prefix, scheduledTime);
  const stores: DurableCycleStoreResult[] = [];
  for (let index = 0; index < selection.stores.length; index += STORE_DO_BATCH_SIZE) {
    const batch = selection.stores.slice(index, index + STORE_DO_BATCH_SIZE);
    stores.push(...await Promise.all(batch.map((store) => runStore(
      env,
      prefix,
      store,
      scheduledTime,
      selection.discovery,
      calendar.activeProducts,
      calendar.officialCatalogProductIds,
      calendar.acceptedLanguages,
      calendar.extraSourcesByStore[store] ?? []
    ))));
  }

  const storeDurationMs = stores.reduce((sum, store) => sum + Math.max(0, store.durationMs), 0);
  return {
    mode: options.mode,
    scheduledTime,
    discovery: selection.discovery,
    calendarDurationMs: Math.max(0, calendar.durationMs),
    storeDurationMs,
    durableDurationMs: Math.max(0, calendar.durationMs) + storeDurationMs,
    wallDurationMs: Math.round(performance.now() - wallStarted),
    durableRequestCount: 1 + stores.length,
    stores,
    pendingAuthorizedFeedStores: selection.pendingAuthorizedFeedStores,
    deferredDiscoveryStores: selection.deferredDiscoveryStores
  };
}

export function discoveryIsDueFromMetadata(lastDiscovery: string | undefined, scheduledTime: number): boolean {
  const parsed = lastDiscovery ? Date.parse(lastDiscovery) : Number.NaN;
  return !Number.isFinite(parsed) || scheduledTime - parsed >= DISCOVERY_INTERVAL_MS;
}
