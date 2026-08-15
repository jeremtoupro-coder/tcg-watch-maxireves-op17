import { CONNECTORS } from "./connectors";
import { configuredStoreStatus } from "./storeAudit";
import {
  isDiscoveryTick,
  parseActiveStores,
  runMonitoringCycle,
  type MonitoringCircuitAnalysis
} from "./monitor";
import { candidateForActiveProducts, type OfficialProduct } from "./opwatchV1";
import { loadOfficialCalendar } from "./officialCalendar";
import { handleSchedulerHealthRequest, handleSchedulerWatchdogAlarm } from "./schedulerHealth";
import { isWebScoutTick } from "./webScout";
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

function discoveryCacheKey(store: StoreKey): string {
  return `discovery:v1:${store}`;
}

async function forceDiscoveryDue(store: StateStore): Promise<void> {
  await store.putMetadata("monitor:last-discovery", "1970-01-01T00:00:00.000Z");
}

async function pruneFastWatchCache(
  stateStore: StateStore,
  store: StoreKey,
  officialProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[],
  result: Awaited<ReturnType<typeof runMonitoringCycle>>,
  discoveredAt: string
): Promise<void> {
  const connector = CONNECTORS.find((entry) => entry.key === store);
  if (!connector || connector.authorizedFeedEnv || connector.authoritativeStructuredFeed) return;
  const audit = result.audits?.find((entry) => entry.store === store);
  if (!audit) return;

  const entries = audit.candidates.flatMap((candidate) => {
    const qualified = candidateForActiveProducts(
      candidate,
      officialProducts,
      acceptedLanguages,
      opWatchV1Config.language.minimumAlertConfidence
    );
    return qualified ? [{ url: qualified.url, references: [...qualified.matchedReferences].sort() }] : [];
  });
  const unique = [...new Map(entries.map((entry) => [entry.url, entry])).values()];
  await stateStore.putMetadata(discoveryCacheKey(store), JSON.stringify({ discoveredAt, entries: unique }));
}

function sourceDurationMs(result: Awaited<ReturnType<typeof runMonitoringCycle>>): number {
  return result.audits?.reduce(
    (total, audit) => total + audit.sources.reduce((sum, source) => sum + Math.max(0, source.durationMs), 0),
    0
  ) ?? 0;
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
          backoffUntil: new Date(backoffUntil).toISOString(),
          discovery: false
        };
        await this.state.storage.put("runtime:health", health);
        return json({ status: "backoff", durationMs, merchantDurationMs: 0, backoffUntil: health.backoffUntil });
      }

      if (input.forceDiscovery === true) await forceDiscoveryDue(stateStore);

      const storeEnv: RuntimeEnv = { ...this.env, ACTIVE_STORES: store };
      const acceptedLanguages = input.acceptedLanguages?.length ? input.acceptedLanguages : ["Français confirmé" as LanguageStatus];
      const result = await runMonitoringCycle(storeEnv, {
        scheduledTime: scheduledTime as number,
        officialProducts: input.officialProducts,
        officialCatalogProductIds: input.officialCatalogProductIds,
        acceptedLanguages,
        extraSourcesByStore: input.extraStoreSources?.length ? { [store]: input.extraStoreSources } : undefined,
        stateStore,
        now: new Date(scheduledTime as number)
      });

      const degraded = result.degradedStores?.some((entry) => entry.store === store) === true;
      if (degraded) {
        const until = new Date((scheduledTime as number) + DEGRADED_BACKOFF_MS).toISOString();
        await stateStore.putMetadata("runtime:backoff-until", until);
      } else {
        await stateStore.putMetadata("runtime:backoff-until", "1970-01-01T00:00:00.000Z");
      }

      if (input.forceDiscovery === true) {
        await pruneFastWatchCache(
          stateStore,
          store,
          input.officialProducts,
          acceptedLanguages,
          result,
          new Date(scheduledTime as number).toISOString()
        );
      }

      const durationMs = Math.round(performance.now() - started);
      const merchantDurationMs = sourceDurationMs(result);
      const audit = result.audits?.find((entry) => entry.store === store);
      const merchantSources = audit?.sources.length ?? 0;
      const successfulMerchantSources = audit?.sources.filter((source) => !source.error).length ?? 0;
      const successfulMerchantCheck = successfulMerchantSources > 0;
      const checkedAt = new Date(scheduledTime as number).toISOString();
      const deferredFastWatch = result.deferredFastWatchStores?.includes(store) === true;
      const error = result.degradedStores?.find((entry) => entry.store === store)?.errors.join(" | ");
      const health: StoreRuntimeHealth = {
        store,
        status: degraded ? "degraded" : "completed",
        checkedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        merchantDurationMs,
        candidates: audit?.candidates.length ?? 0,
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
        ...(audit && result.analysis
          ? { analysis: result.analysis }
          : previousHealth?.analysis
            ? { analysis: previousHealth.analysis }
            : {}),
        ...(audit?.warnings?.length ? { warnings: audit.warnings.slice(0, 8) } : {}),
        sourceKind: audit?.sourceKind ?? previousHealth?.sourceKind,
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

  constructor(private readonly state: DurableObjectState, private readonly env: RuntimeEnv) {}

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
        if (!this.env.WEB_SCOUT) throw new Error("Binding WEB_SCOUT absent.");
        if (!this.env.BRAVE_SEARCH_API_KEY?.trim()) throw new Error("BRAVE_SEARCH_API_KEY absent.");
        const stub = this.env.WEB_SCOUT.get(this.env.WEB_SCOUT.idFromName("production:web-scout"));
        const response = await stub.fetch(new Request("https://web-scout.internal/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduledTime })
        }));
        if (!response.ok) throw new Error(`Web Scout fallback HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        await mark({ kind: "fallback_web_scout_completed", durationMs: performance.now() - scoutStarted });
      } catch (error) {
        await mark({
          kind: "fallback_web_scout_failed",
          durationMs: performance.now() - scoutStarted,
          error: safeError(error)
        });
      }
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
