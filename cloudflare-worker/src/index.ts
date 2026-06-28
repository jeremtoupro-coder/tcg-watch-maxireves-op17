import { auditConnector } from "./audit";
import { WATCH_CONFIG } from "./config";
import { CONNECTORS } from "./connectors";
import { evaluateCandidates } from "./engine";
import { parseActiveStores, runMonitoringCycle } from "./monitor";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function selectRequestedConnectors(requestedStore: StoreKey | null): ConnectorDefinition[] {
  return requestedStore
    ? CONNECTORS.filter((connector) => connector.key === requestedStore)
    : CONNECTORS;
}

function isLive(env: Env): boolean {
  return env.MONITORING_ENABLED === "true" &&
    env.WRITE_STATE === "true" &&
    env.DISCORD_MODE === "live" &&
    Boolean(env.TCG_STATE);
}

async function runAudits(connectors: ConnectorDefinition[]) {
  const results = [];
  for (const connector of connectors) {
    results.push(await auditConnector(connector));
  }
  return results;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Méthode non autorisée. GET uniquement." }, 405);
    }

    if (env.AUDIT_MODE !== "true") {
      return jsonResponse({ error: "Le Worker n'est pas en mode audit sécurisé." }, 503);
    }

    const url = new URL(request.url);
    const live = isLive(env);
    const mode = live ? "LIVE" : "SAFE_PREVIEW";

    if (url.pathname === "/") {
      return jsonResponse({
        project: "TCG Watch — moteur d'alertes configurable",
        deployment: mode,
        runtime: {
          cron: live,
          monitoringEnabled: env.MONITORING_ENABLED === "true",
          discordMode: env.DISCORD_MODE ?? "dry-run",
          stateBindingPresent: Boolean(env.TCG_STATE),
          stateWritesEnabled: env.WRITE_STATE === "true",
          publicStorePollingEnabled: env.ALLOW_PUBLIC_AUDIT === "true",
          automaticPolling: live,
          activeStores: parseActiveStores(env.ACTIVE_STORES),
          schedule: live ? "one task per minute" : "disabled"
        },
        configuration: {
          version: WATCH_CONFIG.version,
          enabledProducts: WATCH_CONFIG.products.filter((product) => product.enabled).length,
          enabledAlerts: WATCH_CONFIG.alerts.filter((alert) => alert.enabled).length,
          file: "config/alerts.json"
        },
        usage: {
          config: "/config",
          health: "/health",
          protectedRoutes: ["/audit", "/evaluate"],
          allowedStores: CONNECTORS.map((connector) => connector.key)
        }
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        mode,
        monitoringEnabled: env.MONITORING_ENABLED === "true",
        stateBindingPresent: Boolean(env.TCG_STATE),
        checkedAt: new Date().toISOString()
      });
    }

    if (url.pathname === "/config") {
      return jsonResponse({
        version: WATCH_CONFIG.version,
        settings: WATCH_CONFIG.settings,
        products: WATCH_CONFIG.products,
        alerts: WATCH_CONFIG.alerts
      });
    }

    if (url.pathname !== "/audit" && url.pathname !== "/evaluate") {
      return jsonResponse({ error: "Route inconnue." }, 404);
    }

    if (env.ALLOW_PUBLIC_AUDIT !== "true") {
      return jsonResponse({
        error: "Route publique désactivée.",
        mode,
        hint: "Les contrôles automatiques sont exécutés uniquement par le gestionnaire planifié."
      }, 403);
    }

    const requestedStore = url.searchParams.get("store") as StoreKey | null;
    const selected = selectRequestedConnectors(requestedStore);

    if (requestedStore && selected.length === 0) {
      return jsonResponse({
        error: `Boutique inconnue: ${requestedStore}`,
        allowedStores: CONNECTORS.map((connector) => connector.key)
      }, 400);
    }

    const stores = await runAudits(selected);

    if (url.pathname === "/audit") {
      return jsonResponse({
        mode: "READ_ONLY_AUDIT",
        checkedAt: new Date().toISOString(),
        stores
      });
    }

    const candidates = stores.flatMap((store) => store.candidates);
    const evaluation = await evaluateCandidates(candidates, env, {
      baselineStores: selected.map((connector) => connector.key)
    });

    return jsonResponse({
      mode: "ALERT_EVALUATION",
      checkedAt: new Date().toISOString(),
      stores,
      evaluation
    });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runMonitoringCycle(env, { scheduledTime: controller.scheduledTime })
        .then((result) => {
          console.log(JSON.stringify({ event: "tcg-monitor", ...result }));
        })
        .catch((error) => {
          console.error("TCG monitoring failed", error);
          throw error;
        })
    );
  }
};
