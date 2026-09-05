import runtimeWorker, {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  WebScoutDurableObject,
  CockpitAuthDurableObject
} from "./runtimeEntryWithCockpitScout";
import { pingExternalDeadman } from "./externalDeadman";
import {
  ProtectedStoreScoutDurableObject,
  isProtectedStoreScoutTick
} from "./protectedStoreScout";
import type { RuntimeEnv } from "./durableMonitoring";
import type { Env } from "./types";

export {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  WebScoutDurableObject,
  CockpitAuthDurableObject,
  ProtectedStoreScoutDurableObject
};

type HardenedRuntimeEnv = RuntimeEnv & {
  PROTECTED_STORE_SCOUT?: DurableObjectNamespace;
  EXTERNAL_DEADMAN_PING_URL?: string;
};

function protectedScoutStub(env: HardenedRuntimeEnv): DurableObjectStub | undefined {
  if (!env.PROTECTED_STORE_SCOUT) return undefined;
  return env.PROTECTED_STORE_SCOUT.get(env.PROTECTED_STORE_SCOUT.idFromName("production:protected-store-scout"));
}

async function runProtectedScout(env: HardenedRuntimeEnv, scheduledTime: number): Promise<void> {
  const stub = protectedScoutStub(env);
  if (!stub) {
    console.error("Protected Store Scout binding absent.");
    return;
  }
  const response = await stub.fetch(new Request("https://protected-store-scout.internal/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduledTime })
  }));
  if (!response.ok) {
    console.error(`Protected Store Scout HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return;
  }
  await response.body?.cancel().catch(() => undefined);
}

async function protectedScoutHealth(request: Request, env: HardenedRuntimeEnv): Promise<Response> {
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim();
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  const stub = protectedScoutStub(env);
  if (!stub) {
    return Response.json({
      bindingPresent: false,
      searchConfigured: Boolean(env.BRAVE_SEARCH_API_KEY?.trim()),
      deadmanConfigured: Boolean(env.EXTERNAL_DEADMAN_PING_URL?.trim()),
      error: "Protected Store Scout non déployé."
    }, { status: 503 });
  }
  const response = await stub.fetch(new Request("https://protected-store-scout.internal/health"));
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return Response.json({ error: "Réponse Protected Scout inexploitable." }, { status: 502 });
  }
  return Response.json({
    bindingPresent: true,
    searchConfigured: Boolean(env.BRAVE_SEARCH_API_KEY?.trim()),
    deadmanConfigured: Boolean(env.EXTERNAL_DEADMAN_PING_URL?.trim()),
    ...data
  }, { status: response.status });
}

export default {
  async fetch(request: Request, baseEnv: Env): Promise<Response> {
    const env = baseEnv as HardenedRuntimeEnv;
    if (new URL(request.url).pathname === "/protected-store-scout-health") {
      return protectedScoutHealth(request, env);
    }
    return runtimeWorker.fetch(request, env);
  },

  scheduled(controller: ScheduledController, baseEnv: Env, ctx: ExecutionContext): void {
    const env = baseEnv as HardenedRuntimeEnv;
    const scheduledTime = controller.scheduledTime;

    if (env.SCHEDULER_MODE === "live") {
      ctx.waitUntil(pingExternalDeadman(env, scheduledTime));
      if (isProtectedStoreScoutTick(scheduledTime)) {
        ctx.waitUntil(runProtectedScout(env, scheduledTime).catch((error) => {
          console.error("Protected Store Scout failed:", error instanceof Error ? error.message : String(error));
        }));
      }
    }

    runtimeWorker.scheduled(controller, env, ctx);
  }
};
