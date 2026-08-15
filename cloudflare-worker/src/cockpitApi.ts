import { CONNECTORS } from "./connectors";
import { configuredStoreStatus } from "./storeAudit";
import {
  COCKPIT_LANGUAGES,
  normalizeRuntimeControlConfig,
  type CockpitAssistantRequest,
  type CockpitManualProduct,
  type RuntimeControlConfig
} from "./controlPlane";
import { dispatchRuntimeHeartbeat } from "./heartbeat";
import { runDistributedMonitoringCycle, type RuntimeEnv } from "./durableMonitoring";
import { markSchedulerHealth, readSchedulerHealth } from "./schedulerHealth";
import {
  DEFAULT_OPENAI_MODEL,
  requestOpenAiAssistant,
  type AssistantRuntimeSnapshot
} from "./openaiAssistant";
import type { LanguageStatus, StoreKey } from "./types";

const ALLOWED_ORIGIN = "https://op-watch-tcg-fr.pages.dev";
const ACTIVE_STALE_MS = 3 * 60_000;
const DISCOVERY_STALE_MS = 20 * 60_000;

type StatusLevel = "green" | "amber" | "red" | "gray";

interface StoreRuntimeHealth {
  store: StoreKey;
  status: "completed" | "degraded" | "backoff" | "overlap" | "error";
  checkedAt: string;
  completedAt?: string;
  durationMs: number;
  merchantDurationMs: number;
  candidates: number;
  healthy?: boolean;
  sourceKind?: string;
  error?: string;
  backoffUntil?: string;
  discovery?: boolean;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}

function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(request)
    }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function authorized(request: Request, env: RuntimeEnv): Promise<boolean> {
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim() ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return Boolean(expected && bearer) && constantTimeEqual(bearer, expected);
}

function calendarStub(env: RuntimeEnv): DurableObjectStub {
  if (!env.CALENDAR_COORDINATOR) throw new Error("CALENDAR_COORDINATOR absent.");
  return env.CALENDAR_COORDINATOR.get(env.CALENDAR_COORDINATOR.idFromName("production:calendar"));
}

function storeStub(env: RuntimeEnv, store: StoreKey): DurableObjectStub {
  if (!env.STORE_MONITORS) throw new Error("STORE_MONITORS absent.");
  return env.STORE_MONITORS.get(env.STORE_MONITORS.idFromName(`production:store:${store}`));
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T;
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
  return data;
}

async function readControlConfig(env: RuntimeEnv): Promise<RuntimeControlConfig> {
  return await readJson(await calendarStub(env).fetch(new Request("https://calendar.internal/control", {
    method: "GET"
  })));
}

async function writeControlConfig(
  env: RuntimeEnv,
  config: RuntimeControlConfig,
  invalidateStores = true
): Promise<RuntimeControlConfig> {
  const saved = await readJson<RuntimeControlConfig>(await calendarStub(env).fetch(new Request("https://calendar.internal/control", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  })));
  if (!invalidateStores) return saved;
  await Promise.all(CONNECTORS.map(async (connector) => {
    try {
      await storeStub(env, connector.key).fetch(new Request("https://store.internal/invalidate", { method: "POST" }));
    } catch {
      // Une invalidation manquée ne bloque pas l'enregistrement ; la Discovery
      // périodique reprendra naturellement au plus tard quelques minutes après.
    }
  }));
  return saved;
}

async function readStoreHealth(env: RuntimeEnv, store: StoreKey): Promise<StoreRuntimeHealth | undefined> {
  try {
    const response = await storeStub(env, store).fetch(new Request("https://store.internal/health", { method: "GET" }));
    if (response.status === 404) return undefined;
    const data = await readJson<{ health?: StoreRuntimeHealth }>(response);
    return data.health;
  } catch {
    return undefined;
  }
}

async function readCalendarView(env: RuntimeEnv): Promise<{
  fetchedAt?: string;
  activeProducts: Array<{ id: string; label: string; releaseDate: string; aliases: string[] }>;
  acceptedLanguages?: LanguageStatus[];
  controlUpdatedAt?: string;
}> {
  return await readJson(await calendarStub(env).fetch(new Request("https://calendar.internal/calendar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime: Date.now() })
  })));
}

function healthAgeMs(health: StoreRuntimeHealth | undefined, now: number): number | undefined {
  if (!health?.checkedAt) return undefined;
  const parsed = Date.parse(health.checkedAt);
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : undefined;
}

function classifyStore(
  connector: typeof CONNECTORS[number],
  configured: ReturnType<typeof configuredStoreStatus>,
  health: StoreRuntimeHealth | undefined,
  now: number
): {
  level: StatusLevel;
  label: string;
  detail: string;
  ageMs?: number;
} {
  if (configured === "pending_authorized_feed") {
    return {
      level: "amber",
      label: "En attente partenaire",
      detail: "Flux autorisé requis avant activation de cette boutique."
    };
  }
  if (configured === "discovery_only") {
    const age = healthAgeMs(health, now);
    if (health && age !== undefined && age <= DISCOVERY_STALE_MS && health.status === "completed") {
      return {
        level: "amber",
        label: "Discovery uniquement",
        detail: "La boutique est contrôlée périodiquement mais ne participe pas encore au Fast Watch commercial.",
        ageMs: age
      };
    }
    return {
      level: "amber",
      label: "Discovery limitée",
      detail: health?.error ?? "Pas de Fast Watch commercial actif.",
      ...(age !== undefined ? { ageMs: age } : {})
    };
  }
  if (configured === "disabled") {
    return { level: "gray", label: "Désactivé", detail: "Boutique volontairement désactivée." };
  }

  const age = healthAgeMs(health, now);
  if (!health) {
    return { level: "red", label: "Aucune preuve de cycle", detail: "Aucun état persistant récent n'est disponible." };
  }
  if (age === undefined || age > ACTIVE_STALE_MS) {
    return {
      level: "red",
      label: "Cycle en retard",
      detail: `Dernier contrôle trop ancien (${health.checkedAt}).`,
      ...(age !== undefined ? { ageMs: age } : {})
    };
  }
  if (health.status !== "completed") {
    return {
      level: "red",
      label: health.status === "backoff" ? "Backoff / incident" : "Incident",
      detail: health.error ?? `Dernier cycle : ${health.status}.`,
      ageMs: age
    };
  }
  if (connector.key === "amazon-fr" && health.candidates === 0) {
    return {
      level: "red",
      label: "Non opérationnel",
      detail: "Le moteur tourne mais aucune source Amazon exploitable n'est actuellement qualifiée.",
      ageMs: age
    };
  }

  return {
    level: "green",
    label: "Opérationnel",
    detail: health.candidates > 0
      ? `${health.candidates} candidat${health.candidates > 1 ? "s" : ""} observé${health.candidates > 1 ? "s" : ""} au dernier cycle.`
      : "Cycle sain ; aucun candidat cible observé sur ce passage.",
    ageMs: age
  };
}

async function buildStatus(env: RuntimeEnv) {
  const now = Date.now();
  const [control, calendar, healthRows, schedulerState] = await Promise.all([
    readControlConfig(env),
    readCalendarView(env),
    Promise.all(CONNECTORS.map(async (connector) => ({
      connector,
      configured: configuredStoreStatus(connector, env),
      health: await readStoreHealth(env, connector.key)
    }))),
    readSchedulerHealth(env).catch((error) => ({
      health: null,
      observed: {
        status: "never_seen" as const,
        observedRecently: false,
        staleAfterMs: ACTIVE_STALE_MS
      },
      error: error instanceof Error ? error.message : String(error)
    }))
  ]);

  const stores = healthRows.map(({ connector, configured, health }) => {
    const state = classifyStore(connector, configured, health, now);
    return {
      key: connector.key,
      name: connector.name,
      configuredStatus: configured,
      sourceKind: health?.sourceKind ?? (configured === "pending_authorized_feed" ? "authorized_feed_required" : "unknown"),
      candidates: health?.candidates ?? null,
      lastCheck: health?.checkedAt ?? null,
      durationMs: health?.durationMs ?? null,
      merchantDurationMs: health?.merchantDurationMs ?? null,
      runtimeStatus: health?.status ?? null,
      ...state
    };
  });

  const totals = {
    green: stores.filter((store) => store.level === "green").length,
    amber: stores.filter((store) => store.level === "amber").length,
    red: stores.filter((store) => store.level === "red").length,
    gray: stores.filter((store) => store.level === "gray").length
  };
  const runtimeConfigured = env.MONITORING_ENABLED === "true" &&
    env.WRITE_STATE === "true" &&
    env.DISCORD_MODE === "live" &&
    env.SCHEDULER_MODE === "live" &&
    env.CRON_CONFIGURED === "true" &&
    env.RUNTIME_TEST_MODE !== "true" &&
    Boolean(env.STORE_MONITORS && env.CALENDAR_COORDINATOR);
  const runtimeLive = runtimeConfigured && schedulerState.observed.observedRecently;

  const activeById = new Map(calendar.activeProducts.map((product) => [product.id, product]));
  const manualById = new Map(control.manualProducts.map((product) => [product.id, product]));
  const controllableIds = [...new Set([
    ...activeById.keys(),
    ...manualById.keys(),
    ...Object.keys(control.productOverrides)
  ])].sort();
  const controllableProducts = controllableIds.map((id) => {
    const active = activeById.get(id);
    const manual = manualById.get(id);
    const override = control.productOverrides[id];
    return {
      id,
      label: active?.label ?? manual?.label ?? `${id} — référence désactivée`,
      releaseDate: active?.releaseDate ?? manual?.releaseDate ?? null,
      aliases: active?.aliases ?? manual?.aliases ?? [id],
      manual: Boolean(manual),
      active: Boolean(active),
      enabled: override?.enabled !== false && manual?.enabled !== false,
      stopAt: override?.stopAt ?? manual?.stopAt ?? null,
      game: manual?.game ?? "one-piece"
    };
  });

  return {
    checkedAt: new Date(now).toISOString(),
    runtime: {
      live: runtimeLive,
      configuredLive: runtimeConfigured,
      monitoring: env.MONITORING_ENABLED === "true",
      stateWrites: env.WRITE_STATE === "true",
      discord: env.DISCORD_MODE === "live" && Boolean(env.DISCORD_WEBHOOK_URL),
      scheduler: schedulerState.observed.observedRecently,
      schedulerConfigured: env.CRON_CONFIGURED === "true",
      schedulerObserved: schedulerState.observed,
      schedulerHealth: schedulerState.health,
      ...(Object.hasOwn(schedulerState, "error")
        ? { schedulerHealthError: (schedulerState as { error?: string }).error }
        : {}),
      runtimeTest: env.RUNTIME_TEST_MODE === "true",
      stateBackend: "durable_objects",
      heartbeatParis: ["10:00", "22:00"]
    },
    totals,
    stores,
    calendar: {
      fetchedAt: calendar.fetchedAt ?? null,
      activeProducts: calendar.activeProducts,
      controllableProducts,
      acceptedLanguages: calendar.acceptedLanguages ?? control.languages,
      controlUpdatedAt: calendar.controlUpdatedAt ?? control.updatedAt
    },
    assistant: {
      configured: Boolean(env.OPENAI_API_KEY?.trim()),
      model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      webSearch: true,
      writeAccess: false,
      storage: "local-history + OpenAI store=false"
    },
    control
  };
}

function assistantSnapshot(status: Awaited<ReturnType<typeof buildStatus>>): AssistantRuntimeSnapshot {
  return {
    checkedAt: status.checkedAt,
    runtime: status.runtime,
    totals: status.totals,
    stores: status.stores.map((store) => ({
      key: store.key,
      name: store.name,
      configuredStatus: store.configuredStatus,
      sourceKind: store.sourceKind,
      candidates: store.candidates,
      lastCheck: store.lastCheck,
      runtimeStatus: store.runtimeStatus,
      level: store.level,
      label: store.label,
      detail: store.detail
    })),
    calendar: status.calendar,
    control: {
      languages: status.control.languages,
      manualProducts: status.control.manualProducts,
      productOverrides: status.control.productOverrides
    }
  };
}

function cleanDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function cleanProductInput(raw: unknown): CockpitManualProduct {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<CockpitManualProduct>;
  const id = typeof input.id === "string" ? input.id.trim().toUpperCase().slice(0, 80) : "";
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 180) : "";
  if (!id || !label) throw new Error("Référence et libellé sont obligatoires.");
  const releaseDate = cleanDate(input.releaseDate) ?? new Date().toISOString().slice(0, 10);
  return {
    id,
    label,
    game: typeof input.game === "string" && input.game.trim() ? input.game.trim().slice(0, 60) : "other",
    aliases: Array.isArray(input.aliases)
      ? [...new Set([id, ...input.aliases.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)])].slice(0, 20)
      : [id],
    enabled: input.enabled !== false,
    releaseDate,
    ...(cleanDate(input.startsAt) ? { startsAt: cleanDate(input.startsAt) } : {}),
    ...(cleanDate(input.stopAt) ? { stopAt: cleanDate(input.stopAt) } : {}),
    storeUrls: input.storeUrls && typeof input.storeUrls === "object" ? input.storeUrls : {}
  };
}

async function runAssistant(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!env.OPENAI_API_KEY?.trim()) {
    return json(request, { error: "Assistant OpenAI non configuré : OPENAI_API_KEY manque sur le Worker." }, 503);
  }
  const body = await request.json() as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (text.length < 3) return json(request, { error: "Demande trop courte." }, 400);

  const createdAt = new Date();
  const requestId = crypto.randomUUID();
  const current = await readControlConfig(env);
  const pending: CockpitAssistantRequest = {
    id: requestId,
    createdAt: createdAt.toISOString(),
    text,
    status: "pending"
  };
  const withPending = normalizeRuntimeControlConfig({
    ...current,
    updatedAt: createdAt.toISOString(),
    assistantRequests: [...current.assistantRequests, pending].slice(-50)
  }, createdAt);
  await writeControlConfig(env, withPending, false);

  try {
    const status = await buildStatus(env);
    const result = await requestOpenAiAssistant(env, text, assistantSnapshot(status), current.assistantRequests);
    const completedAt = new Date();
    const latest = await readControlConfig(env);
    const completed: CockpitAssistantRequest = {
      ...pending,
      status: "done",
      completedAt: completedAt.toISOString(),
      answer: result.answer,
      model: result.model,
      responseId: result.responseId,
      sources: result.sources,
      ...(result.usage ? { usage: result.usage } : {})
    };
    const next = normalizeRuntimeControlConfig({
      ...latest,
      updatedAt: completedAt.toISOString(),
      assistantRequests: latest.assistantRequests.map((item) => item.id === requestId && item.status === "pending" ? completed : item)
    }, completedAt);
    await writeControlConfig(env, next, false);
    return json(request, { ok: true, request: completed });
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const latest = await readControlConfig(env);
    const failed: CockpitAssistantRequest = {
      ...pending,
      status: "error",
      completedAt: completedAt.toISOString(),
      error: message.slice(0, 800)
    };
    const next = normalizeRuntimeControlConfig({
      ...latest,
      updatedAt: completedAt.toISOString(),
      assistantRequests: latest.assistantRequests.map((item) => item.id === requestId && item.status === "pending" ? failed : item)
    }, completedAt);
    await writeControlConfig(env, next, false);
    return json(request, { error: message, request: failed }, 502);
  }
}

async function mutateControl(request: Request, env: RuntimeEnv): Promise<Response> {
  const body = await request.json() as { action?: string; [key: string]: unknown };
  const current = await readControlConfig(env);
  let next: RuntimeControlConfig = structuredClone(current);
  const now = new Date();
  let invalidateStores = true;

  switch (body.action) {
    case "setLanguages": {
      const languages = Array.isArray(body.languages)
        ? body.languages.filter((language): language is LanguageStatus =>
            typeof language === "string" && COCKPIT_LANGUAGES.includes(language as LanguageStatus))
        : [];
      if (!languages.length) throw new Error("Au moins une langue doit rester active.");
      next.languages = [...new Set(languages)];
      break;
    }
    case "setProductOverride": {
      const id = typeof body.id === "string" ? body.id.trim().toUpperCase().slice(0, 80) : "";
      if (!id) throw new Error("Référence manquante.");
      next.productOverrides[id] = {
        ...(next.productOverrides[id] ?? {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(cleanDate(body.stopAt) ? { stopAt: cleanDate(body.stopAt) } : body.stopAt === "" ? { stopAt: undefined } : {})
      };
      if (next.productOverrides[id].stopAt === undefined) delete next.productOverrides[id].stopAt;
      break;
    }
    case "addManualProduct": {
      const product = cleanProductInput(body.product);
      next.manualProducts = [...next.manualProducts.filter((item) => item.id !== product.id), product];
      break;
    }
    case "deleteManualProduct": {
      const id = typeof body.id === "string" ? body.id.trim().toUpperCase() : "";
      next.manualProducts = next.manualProducts.filter((item) => item.id !== id);
      break;
    }
    case "queueAssistantRequest": {
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
      if (text.length < 5) throw new Error("Demande trop courte.");
      next.assistantRequests = [...next.assistantRequests, {
        id: crypto.randomUUID(),
        createdAt: now.toISOString(),
        text,
        status: "pending" as const
      }].slice(-50);
      invalidateStores = false;
      break;
    }
    case "cancelAssistantRequest": {
      const id = typeof body.id === "string" ? body.id : "";
      next.assistantRequests = next.assistantRequests.map((item) =>
        item.id === id && item.status === "pending" ? { ...item, status: "cancelled" as const } : item
      );
      invalidateStores = false;
      break;
    }
    case "heartbeatNow": {
      const scheduledTime = Date.now();
      await markSchedulerHealth(env, { kind: "manual_heartbeat_started", scheduledTime }).catch(() => undefined);
      try {
        const cycle = await runDistributedMonitoringCycle(env, { mode: "live", scheduledTime });
        const delivery = await dispatchRuntimeHeartbeat(cycle, env, true);
        await markSchedulerHealth(env, {
          kind: delivery.sent === 1 ? "manual_heartbeat_completed" : "manual_heartbeat_failed",
          scheduledTime,
          ...(delivery.sent === 1 ? {} : { error: delivery.errors.join(" | ") || "Discord n'a confirmé aucun envoi." })
        }).catch(() => undefined);
        return json(request, { ok: delivery.sent === 1, delivery, cycle: {
          completedStores: cycle.stores.filter((store) => store.status === "completed").length,
          pendingStores: cycle.pendingAuthorizedFeedStores,
          incidents: cycle.stores.filter((store) => store.status !== "completed").map((store) => ({ store: store.store, status: store.status }))
        } }, delivery.sent === 1 ? 200 : 502);
      } catch (error) {
        await markSchedulerHealth(env, {
          kind: "manual_heartbeat_failed",
          scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }).catch(() => undefined);
        throw error;
      }
    }
    case "runStoreNow": {
      const store = typeof body.store === "string" ? body.store : "";
      if (!CONNECTORS.some((connector) => connector.key === store)) throw new Error("Boutique inconnue.");
      const cycle = await runDistributedMonitoringCycle(env, {
        mode: "live",
        scheduledTime: Date.now(),
        forceDiscovery: true,
        forceStore: store
      });
      return json(request, { ok: true, cycle });
    }
    default:
      throw new Error("Action cockpit inconnue.");
  }

  next.updatedAt = now.toISOString();
  next = normalizeRuntimeControlConfig(next, now);
  const saved = await writeControlConfig(env, next, invalidateStores);
  return json(request, { ok: true, control: saved });
}

export async function handleCockpitApi(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const origin = request.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) return json(request, { error: "Origine refusée." }, 403);
  if (!await authorized(request, env)) return json(request, { error: "Accès cockpit invalide." }, 401);

  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === "/cockpit/api/status" && request.method === "GET") {
      return json(request, await buildStatus(env));
    }
    if (pathname === "/cockpit/api/control" && request.method === "POST") {
      return await mutateControl(request, env);
    }
    if (pathname === "/cockpit/api/assistant" && request.method === "POST") {
      return await runAssistant(request, env);
    }
    return json(request, { error: "Route cockpit inconnue." }, 404);
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
