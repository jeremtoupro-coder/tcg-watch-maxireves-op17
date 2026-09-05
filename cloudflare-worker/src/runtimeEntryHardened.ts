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
  if (!stub) return Response.json({ error: "Protected Store Scout non déployé." }, { status: 503 });
  return stub.fetch(new Request("https://protected-store-scout.internal/health"));
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
