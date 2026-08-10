import previewWorker from "./index";
import {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  runDistributedMonitoringCycle,
  type RuntimeEnv
} from "./durableMonitoring";
import type { Env, StoreKey } from "./types";

export { CalendarCoordinatorDurableObject, StoreMonitorDurableObject };

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

async function runtimeTest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (env.RUNTIME_TEST_MODE !== "true") return json({ error: "Route inconnue." }, 404);
  if (request.method !== "GET") return json({ error: "Méthode non autorisée. GET uniquement." }, 405);
  if (!validRuntimeToken(request, env)) return json({ error: "Jeton runtime absent ou invalide." }, 401);

  const url = new URL(request.url);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/runtime-test") {
      return runtimeTest(request, env as RuntimeEnv);
    }
    return previewWorker.fetch(request, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const runtimeEnv = env as RuntimeEnv;
    if (runtimeEnv.SCHEDULER_MODE !== "live") return;
    ctx.waitUntil(runDistributedMonitoringCycle(runtimeEnv, {
      mode: "live",
      scheduledTime: controller.scheduledTime
    }).then(() => undefined));
  }
};
