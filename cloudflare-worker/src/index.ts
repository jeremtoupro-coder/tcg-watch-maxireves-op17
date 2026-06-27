import { auditConnector } from "./audit";
import { WATCH_CONFIG } from "./config";
import { fantasySphere } from "./connectors/fantasySphere";
import { ludotrotter } from "./connectors/ludotrotter";
import { maxireves } from "./connectors/maxireves";
import { oupi } from "./connectors/oupi";
import { evaluateCandidates } from "./engine";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

const CONNECTORS: ConnectorDefinition[] = [maxireves, ludotrotter, oupi, fantasySphere];

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

function selectConnectors(requestedStore: StoreKey | null): ConnectorDefinition[] {
  return requestedStore
    ? CONNECTORS.filter((connector) => connector.key === requestedStore)
    : CONNECTORS;
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

    if (url.pathname === "/") {
      return jsonResponse({
        project: "TCG Watch — moteur d'alertes configurable",
        deployment: "SAFE_PREVIEW",
        safeMode: {
          cron: false,
          discordMode: env.DISCORD_MODE ?? "dry-run",
          stateBindingPresent: Boolean(env.TCG_STATE),
          stateWritesEnabled: env.WRITE_STATE === "true",
          publicStorePollingEnabled: env.ALLOW_PUBLIC_AUDIT === "true",
          automaticPolling: false
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
        mode: "SAFE_PREVIEW",
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
        error: "Route désactivée sur la prévisualisation publique.",
        mode: "SAFE_PREVIEW",
        hint: "Les audits réels restent exécutés uniquement depuis GitHub Actions."
      }, 403);
    }

    const requestedStore = url.searchParams.get("store") as StoreKey | null;
    const selected = selectConnectors(requestedStore);

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
  }
};
