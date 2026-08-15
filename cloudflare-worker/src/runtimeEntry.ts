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
  dispatchRuntimeHeartbeatFailure,
  dispatchRuntimeHeartbeatSignal,
  isHeartbeatTick
} from "./heartbeat";
import { handleCockpitApi } from "./cockpitApi";
import { detectAvailability, detectLanguage, matchReferences } from "./matching";
import { isDiscoveryTick } from "./monitor";
import {
  armSchedulerWatchdog,
  markSchedulerHealth,
  readSchedulerHealth,
  type SchedulerMarker
} from "./schedulerHealth";
import { WebScoutDurableObject, isWebScoutTick } from "./webScout";
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

async function runHourlyWebScout(env: WebScoutRuntimeEnv, scheduledTime: number): Promise<boolean> {
  if (!isWebScoutTick(scheduledTime)) return false;
  const stub = webScoutStub(env);
  if (!stub) throw new Error("Binding WEB_SCOUT absent.");
  if (!env.BRAVE_SEARCH_API_KEY?.trim()) throw new Error("BRAVE_SEARCH_API_KEY absent.");
  const response = await stub.fetch(new Request("https://web-scout.internal/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime })
  }));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Web Scout HTTP ${response.status}: ${text.slice(0, 600)}`);
  }
  return true;
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
  if (url.searchParams.get("probe") === "auth") {
    const safe = env.SCHEDULER_MODE === "disabled" &&
      env.DISCORD_MODE === "dry-run" &&
      env.MONITORING_ENABLED === "true" &&
      env.WRITE_STATE === "true" &&
      Boolean(env.RUNTIME_TEST_RUN_ID?.trim());
    if (!safe) {
      return json({ error: "Runtime test non conforme aux garde-fous d'isolation." }, 503);
    }
    return json({
      status: "ready",
      mode: "test",
      schedulerMode: "disabled",
      discordMode: "dry-run",
      productionStateWrites: false
    });
  }

  const rawTime = url.searchParams.get("time");
  const scheduledTime = rawTime ? Number(rawTime) : Date.now();
  if (!Number.isFinite(scheduledTime)) return json({ error: "Paramètre time invalide." }, 400);
  const forceDiscovery = url.searchParams.get("discovery") === "true";
  const forceStore = url.searchParams.get("store") as StoreKey | null;

  try {
    return json(await runDistributedMonitoringCycle(env, {
      mode: "test",
      scheduledTime,
      forceDiscovery,
      forceStore: forceStore ?? undefined
    }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
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
    if (runtimeEnv.SCHEDULER_MODE !== "live") return;
    const scheduledTime = controller.scheduledTime;
    const heartbeatTick = isHeartbeatTick(scheduledTime);
    const discovery = isDiscoveryTick(scheduledTime);

    // Cette écriture très courte prouve que Cloudflare a réellement livré le
    // Scheduled Event et réarme une alarme Durable Object indépendante du cron.
    ctx.waitUntil(safeSchedulerMark(runtimeEnv, {
      kind: "scheduled_received",
      scheduledTime,
      observedTime: Date.now()
    }));

    const heartbeatBeforeMonitoring = (async () => {
      if (!heartbeatTick) return;
      await safeSchedulerMark(runtimeEnv, { kind: "automatic_heartbeat_started", scheduledTime });
      try {
        const delivery = await dispatchRuntimeHeartbeatSignal(scheduledTime, runtimeEnv);
        if (delivery.sent !== 1) {
          const error = delivery.errors.join(" | ") || "Discord n'a confirmé aucun envoi.";
          await safeSchedulerMark(runtimeEnv, { kind: "automatic_heartbeat_failed", scheduledTime, error });
          console.error("Scheduled pre-cycle heartbeat delivery failed:", JSON.stringify(delivery));
          return;
        }
        await safeSchedulerMark(runtimeEnv, { kind: "automatic_heartbeat_completed", scheduledTime });
      } catch (error) {
        await safeSchedulerMark(runtimeEnv, {
          kind: "automatic_heartbeat_failed",
          scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        });
        console.error("Scheduled pre-cycle heartbeat crashed:", error instanceof Error ? error.message : String(error));
      }
    })();

    // Le monitoring conserve l'ordre heartbeat -> marchands, mais Web Scout
    // dispose désormais de son propre waitUntil : un circuit ne supprime plus
    // silencieusement l'autre en cas d'exception.
    ctx.waitUntil((async () => {
      await heartbeatBeforeMonitoring;
      const started = performance.now();
      await safeSchedulerMark(runtimeEnv, { kind: "monitoring_started", scheduledTime, discovery });
      try {
        const cycle = await runDistributedMonitoringCycle(runtimeEnv, {
          mode: "live",
          scheduledTime
        });
        const completedStores = cycle.stores.filter((store) => store.status === "completed").length;
        const incidentStores = cycle.stores.filter((store) => store.status !== "completed").length;
        await safeSchedulerMark(runtimeEnv, {
          kind: "monitoring_completed",
          scheduledTime,
          discovery: cycle.discovery,
          durationMs: performance.now() - started,
          completedStores,
          incidentStores
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await safeSchedulerMark(runtimeEnv, {
          kind: "monitoring_failed",
          scheduledTime,
          discovery,
          durationMs: performance.now() - started,
          error: message
        });
        console.error("Scheduled monitoring cycle failed:", message);
        if (heartbeatTick) {
          try {
            const delivery = await dispatchRuntimeHeartbeatFailure(scheduledTime, runtimeEnv, error);
            if (delivery.sent !== 1) {
              console.error("Scheduled fail-safe cycle alert delivery failed:", JSON.stringify(delivery));
            }
          } catch (heartbeatError) {
            console.error(
              "Scheduled fail-safe cycle alert crashed:",
              heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError)
            );
          }
        }
      }
    })());

    if (isWebScoutTick(scheduledTime)) {
      ctx.waitUntil((async () => {
        const started = performance.now();
        await safeSchedulerMark(runtimeEnv, { kind: "web_scout_started", scheduledTime });
        try {
          await runHourlyWebScout(runtimeEnv, scheduledTime);
          await safeSchedulerMark(runtimeEnv, {
            kind: "web_scout_completed",
            scheduledTime,
            durationMs: performance.now() - started
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await safeSchedulerMark(runtimeEnv, {
            kind: "web_scout_failed",
            scheduledTime,
            durationMs: performance.now() - started,
            error: message
          });
          console.error("Web Scout error:", message);
        }
      })());
    }
  }
};
