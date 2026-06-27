import { auditConnector } from "./audit";
import { fantasySphere } from "./connectors/fantasySphere";
import { ludotrotter } from "./connectors/ludotrotter";
import { maxireves } from "./connectors/maxireves";
import { oupi } from "./connectors/oupi";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

const CONNECTORS: ConnectorDefinition[] = [maxireves, ludotrotter, oupi, fantasySphere];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Méthode non autorisée. Audit GET uniquement." }, 405);
    }

    if (env.AUDIT_MODE !== "true") {
      return jsonResponse({ error: "Le Worker n'est pas en mode audit sécurisé." }, 503);
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return jsonResponse({
        project: "TCG Watch — audit Cloudflare en lecture seule",
        safeMode: {
          cron: false,
          discord: false,
          storageWrites: false,
          automaticPolling: false
        },
        usage: {
          allStores: "/audit",
          oneStore: "/audit?store=maxireves",
          allowedStores: CONNECTORS.map((connector) => connector.key)
        }
      });
    }

    if (url.pathname !== "/audit") {
      return jsonResponse({ error: "Route inconnue." }, 404);
    }

    const requestedStore = url.searchParams.get("store") as StoreKey | null;
    const selected = requestedStore
      ? CONNECTORS.filter((connector) => connector.key === requestedStore)
      : CONNECTORS;

    if (requestedStore && selected.length === 0) {
      return jsonResponse({
        error: `Boutique inconnue: ${requestedStore}`,
        allowedStores: CONNECTORS.map((connector) => connector.key)
      }, 400);
    }

    const results = [];
    for (const connector of selected) {
      results.push(await auditConnector(connector));
    }

    return jsonResponse({
      mode: "READ_ONLY_AUDIT",
      checkedAt: new Date().toISOString(),
      stores: results
    });
  }
};
