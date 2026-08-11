import runtimeWorker, {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  WebScoutDurableObject
} from "./runtimeEntry";
import { handleCockpitWebScout } from "./cockpitWebScout";
import type { RuntimeEnv } from "./durableMonitoring";
import type { Env } from "./types";

export { CalendarCoordinatorDurableObject, StoreMonitorDurableObject, WebScoutDurableObject };

type RuntimeWithScoutEnv = RuntimeEnv & { WEB_SCOUT?: DurableObjectNamespace };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/cockpit/api/web-scout") {
      return handleCockpitWebScout(request, env as RuntimeWithScoutEnv);
    }
    return runtimeWorker.fetch(request, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    runtimeWorker.scheduled(controller, env, ctx);
  }
};
