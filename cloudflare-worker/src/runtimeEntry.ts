import previewWorker from "./index";
import {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  assertRuntimeReadiness,
  runDistributedMonitoringCycle,
  type RuntimeEnv
} from "./durableMonitoring";
import { CONNECTORS } from "./connectors";
import {
  dispatchRuntimeHeartbeat,
  dispatchRuntimeHeartbeatFailure
} from "./heartbeat";
import { handleCockpitApi } from "./cockpitApi";
import { detectAvailability, detectLanguage, matchReferences } from "./matching";
import {
  armSchedulerWatchdog,
  markSchedulerHealth,
  readSchedulerHealth,
  type SchedulerMarker
} from "./schedulerHealth";
import { WebScoutDurableObject } from "./webScout";
import type { Env, StoreKey } from "./types";

export { CalendarCoordinatorDurableObject, StoreMonitorDurableObject, WebScoutDurableObject };

type ProductionProbeEnv = RuntimeEnv & { PRODUCTION_PROBE_MODE?: string };
type WebScoutRuntimeEnv = ProductionProbeEnv & { WEB_SCOUT?: DurableObjectNamespace };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
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

function validRuntimeToken(request: Request, env: RuntimeEnv): boolean {
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim();
  if (!expected) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const explicit = request.headers.get("x-op-watch-audit-token")?.trim() ?? "";
  const received = bearer || explicit;
  return Boolean(received) && constantTimeEqual(received, expected);
}

function webScoutStub(env: WebScoutRuntimeEnv): DurableObjectStub | undefined {
  if (!env.WEB_SCOUT) return undefined;
  return env.WEB_SCOUT.get(env.WEB_SCOUT.idFromName("production:web-scout"));
}

async function safeSchedulerMark(env: WebScoutRuntimeEnv, marker: SchedulerMarker): Promise<void> {
  try {
    await markSchedulerHealth(env, marker);
  } catch (error) {
    console.error("Scheduler health mark failed:", error instanceof Error ? error.message : String(error));
  }
}

async function runtimeTest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (env.RUNTIME_TEST_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);

  const url = new URL(request.url);
  const runtimeTestRunId = env.RUNTIME_TEST_RUN_ID?.trim() ?? "";
  const requestedRunId = url.searchParams.get("run")?.trim() ?? "";
  if (!runtimeTestRunId || requestedRunId !== runtimeTestRunId) {
    return json({
      error: "Génération runtime test absente ou remplacée pendant le contrôle.",
      runtimeTestRunId: runtimeTestRunId || null
    }, 409);
  }
  if (url.searchParams.get("probe") === "auth") {
    const safe = env.SCHEDULER_MODE === "disabled" &&
      env.DISCORD_MODE === "dry-run" &&
      env.MONITORING_ENABLED === "true" &&
      env.WRITE_STATE === "true" &&
      Boolean(runtimeTestRunId);
    if (!safe) {
      return json({ error: "Runtime test non conforme aux garde-fous d'isolation." }, 503);
    }
    return json({
      status: "ready",
      mode: "test",
      schedulerMode: "disabled",
      discordMode: "dry-run",
      productionStateWrites: false,
      runtimeTestRunId
    });
  }

  const rawTime = url.searchParams.get("time");
  const scheduledTime = rawTime ? Number(rawTime) : Date.now();
  if (!Number.isFinite(scheduledTime)) return json({ error: "Paramètre time invalide." }, 400);
  const forceDiscovery = url.searchParams.get("discovery") === "true";
  const forceStore = url.searchParams.get("store") as StoreKey | null;

  try {
    const cycle = await runDistributedMonitoringCycle(env, {
      mode: "test",
      scheduledTime,
      forceDiscovery,
      forceStore: forceStore ?? undefined
    });
    return json({ ...cycle, runtimeTestRunId });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      runtimeTestRunId
    }, 503);
  }
}

async function productionReady(request: Request, env: WebScoutRuntimeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);

  try {
    assertRuntimeReadiness(env, "live");
    const schedulerHealth = await readSchedulerHealth(env).catch((error) => ({
      health: null,
      observed: {
        status: "never_seen" as const,
        observedRecently: false,
        staleAfterMs: 3 * 60_000
      },
      readError: error instanceof Error ? error.message : String(error)
    }));
    return json({
      status: "ready",
      mode: "live",
      schedulerMode: env.SCHEDULER_MODE,
      discordMode: env.DISCORD_MODE,
      monitoringEnabled: env.MONITORING_ENABLED === "true",
      stateWritesEnabled: env.WRITE_STATE === "true",
      stores: CONNECTORS.map((connector) => connector.key),
      automaticPolling: schedulerHealth.observed.observedRecently,
      scheduler: {
        configured: env.CRON_CONFIGURED === "true",
        observed: schedulerHealth.observed,
        health: schedulerHealth.health,
        ...(Object.hasOwn(schedulerHealth, "readError")
          ? { readError: (schedulerHealth as { readError?: string }).readError }
          : {})
      },
      webScout: {
        bindingPresent: Boolean(env.WEB_SCOUT),
        searchConfigured: Boolean(env.BRAVE_SEARCH_API_KEY?.trim()),
        cadence: "hourly at minute 07"
      },
      note: "Readiness de configuration et observation persistante du scheduler ; aucun audit marchand n'est exécuté par cette route."
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}

async function productionWebScoutHealth(request: Request, env: WebScoutRuntimeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);
  const stub = webScoutStub(env);
  if (!stub) return json({ error: "Binding WEB_SCOUT absent." }, 503);
  try {
    const response = await stub.fetch(new Request("https://web-scout.internal/health", { method: "GET" }));
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}

async function productionSchedulerHealth(request: Request, env: WebScoutRuntimeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);
  try {
    const result = await readSchedulerHealth(env);
    return json({
      checkedAt: new Date().toISOString(),
      configured: env.CRON_CONFIGURED === "true",
      ...result
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}

async function productionArmSchedulerWatchdog(request: Request, env: WebScoutRuntimeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "POST") return json({ error: "Méthode non autorisée. POST uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);
  try {
    const health = await armSchedulerWatchdog(env);
    return json({ status: "armed", health });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}

function hostAllowedForConnector(connector: (typeof CONNECTORS)[number], hostname: string): boolean {
  return connector.sources.some((source) => {
    try {
      return new URL(source).hostname === hostname;
    } catch {
      return false;
    }
  });
}

async function productionMerchantProbe(request: Request, env: ProductionProbeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);

  const requestUrl = new URL(request.url);
  const store = requestUrl.searchParams.get("store") ?? "";
  const targetRaw = requestUrl.searchParams.get("url") ?? "";
  const connector = CONNECTORS.find((item) => item.key === store);
  if (!connector) return json({ error: "Boutique inconnue." }, 400);

  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    return json({ error: "URL invalide." }, 400);
  }
  if (target.protocol !== "https:" || !hostAllowedForConnector(connector, target.hostname)) {
    return json({ error: "URL hors domaine configuré pour cette boutique." }, 400);
  }
  const exactSource = connector.sources.includes(target.toString());
  const productPage = connector.productUrlPatterns.some((pattern) => pattern.test(target.toString()));
  if (!exactSource && !productPage) {
    return json({ error: "URL non reconnue comme source ou fiche produit configurée." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const started = performance.now();
  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: connector.requestHeaders
    });
    const text = await response.text();
    return json({
      store: connector.key,
      status: response.status,
      ok: response.ok,
      finalHost: new URL(response.url || target.toString()).hostname,
      contentType: response.headers.get("content-type"),
      durationMs: Math.round(performance.now() - started),
      responseBytes: new TextEncoder().encode(text).byteLength,
      signals: {
        onePiece: /one[\s-]*piece/i.test(text),
        references: matchReferences(text).slice(0, 20),
        language: detectLanguage(text),
        availability: detectAvailability(text)
      }
    });
  } catch (error) {
    return json({
      store: connector.key,
      status: "fetch-error",
      ok: false,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error)
    }, 200);
  } finally {
    clearTimeout(timeout);
  }
}

async function productionHeartbeatNow(request: Request, env: ProductionProbeEnv): Promise<Response> {
  if (env.PRODUCTION_PROBE_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "POST") return json({ error: "Méthode non autorisée. POST uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);

  const scheduledTime = Date.now();
  await safeSchedulerMark(env, { kind: "manual_heartbeat_started", scheduledTime });
  try {
    assertRuntimeReadiness(env, "live");
    const cycle = await runDistributedMonitoringCycle(env, {
      mode: "live",
      scheduledTime
    });
    const delivery = await dispatchRuntimeHeartbeat(cycle, env, true);
    if (delivery.sent !== 1) {
      await safeSchedulerMark(env, {
        kind: "manual_heartbeat_failed",
        scheduledTime,
        error: delivery.errors.join(" | ") || "Discord n'a confirmé aucun envoi."
      });
      return json({ status: "failed", delivery }, 502);
    }
    await safeSchedulerMark(env, { kind: "manual_heartbeat_completed", scheduledTime });
    return json({
      status: "sent",
      delivery,
      cycle: {
        discovery: cycle.discovery,
        completedStores: cycle.stores.filter((store) => store.status === "completed").length,
        pendingAuthorizedFeedStores: cycle.pendingAuthorizedFeedStores,
        incidents: cycle.stores.filter((store) => store.status !== "completed").map((store) => ({
          store: store.store,
          status: store.status
        }))
      }
    });
  } catch (error) {
    await safeSchedulerMark(env, {
      kind: "manual_heartbeat_failed",
      scheduledTime,
      error: error instanceof Error ? error.message : String(error)
    });
    const delivery = await dispatchRuntimeHeartbeatFailure(scheduledTime, env, error, true).catch((deliveryError) => ({
      attempted: 0,
      sent: 0,
      errors: [deliveryError instanceof Error ? deliveryError.message : String(deliveryError)]
    }));
    return json({ error: error instanceof Error ? error.message : String(error), delivery }, 503);
  }
}

async function handOffScheduledMonitoring(
  env: WebScoutRuntimeEnv,
  scheduledTime: number,
  mode: "test" | "live"
): Promise<void> {
  if (!env.CALENDAR_COORDINATOR) throw new Error("CALENDAR_COORDINATOR absent pour l'orchestration scheduler.");
  const stub = env.CALENDAR_COORDINATOR.get(env.CALENDAR_COORDINATOR.idFromName("production:scheduler-health"));
  const response = await stub.fetch(new Request("https://scheduler-health.internal/scheduled-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime, mode })
  }));
  if (!response.ok) {
    const error = (await response.text()).slice(0, 600);
    console.error(`Scheduled monitoring coordinator HTTP ${response.status}: ${error}`);
    return;
  }
  await response.body?.cancel().catch(() => undefined);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/cockpit/api/")) {
      return handleCockpitApi(request, env as RuntimeEnv);
    }
    if (pathname === "/runtime-test") {
      return runtimeTest(request, env as RuntimeEnv);
    }
    if (pathname === "/runtime-ready") {
      return productionReady(request, env as WebScoutRuntimeEnv);
    }
    if (pathname === "/web-scout-health") {
      return productionWebScoutHealth(request, env as WebScoutRuntimeEnv);
    }
    if (pathname === "/scheduler-health") {
      return productionSchedulerHealth(request, env as WebScoutRuntimeEnv);
    }
    if (pathname === "/scheduler-watchdog/arm") {
      return productionArmSchedulerWatchdog(request, env as WebScoutRuntimeEnv);
    }
    if (pathname === "/merchant-probe") {
      return productionMerchantProbe(request, env as ProductionProbeEnv);
    }
    if (pathname === "/heartbeat-now") {
      return productionHeartbeatNow(request, env as ProductionProbeEnv);
    }
    return previewWorker.fetch(request, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const runtimeEnv = env as WebScoutRuntimeEnv;
    const isolatedSchedulerTest = runtimeEnv.SCHEDULER_MODE === "test" &&
      runtimeEnv.RUNTIME_TEST_MODE === "true" &&
      runtimeEnv.DISCORD_MODE === "dry-run" &&
      Boolean(runtimeEnv.RUNTIME_TEST_RUN_ID?.trim());
    if (runtimeEnv.SCHEDULER_MODE !== "live" && !isolatedSchedulerTest) return;
    const scheduledTime = controller.scheduledTime;
    // Le Cron Free n'a que 10 ms de CPU : il remet immédiatement le travail
    // au Durable Object scheduler (30 s CPU), qui envoie le heartbeat puis
    // orchestre les boutiques. Le handler cron ne parse plus leurs réponses.
    ctx.waitUntil(handOffScheduledMonitoring(
      runtimeEnv,
      scheduledTime,
      isolatedSchedulerTest ? "test" : "live"
    ).catch((error) => {
      console.error("Scheduled monitoring hand-off failed:", error instanceof Error ? error.message : String(error));
    }));

  }
};
