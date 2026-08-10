import { CONNECTORS } from "./connectors";
import { evaluateCandidates } from "./engine";
import { parseActiveStores } from "./monitor";
import {
  auditStore,
  configuredStoreStatus,
  hasConfiguredAuthorizedFeed
} from "./storeAudit";
import opWatchV1Config from "../config/opwatch-v1.json";
import { buildActiveWatchConfig, candidateForActiveProducts } from "./opwatchV1";
import { loadOfficialCalendar } from "./officialCalendar";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

const CALENDAR_PREVIEW_CACHE_MS = 15 * 60 * 1000;
let calendarPreviewCache: {
  expiresAt: number;
  value: Awaited<ReturnType<typeof loadOfficialCalendar>>;
} | undefined;
let calendarPreviewLoad: Promise<Awaited<ReturnType<typeof loadOfficialCalendar>>> | undefined;

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

async function runAudits(connectors: ConnectorDefinition[], env: Env) {
  const results = [];
  for (const connector of connectors) {
    results.push(await auditStore(connector, env));
  }
  return results;
}

function authorizedFeedReadiness(env: Env) {
  return CONNECTORS
    .filter((connector) => Boolean(connector.authorizedFeedEnv))
    .map((connector) => ({
      store: connector.key,
      configured: hasConfiguredAuthorizedFeed(connector, env),
      directPollingDisabledWithoutFeed: connector.directPollingDisabledWithoutFeed === true,
      status: configuredStoreStatus(connector, env)
    }));
}

function storeReadiness(env: Env) {
  return CONNECTORS.map((connector) => ({
    store: connector.key,
    name: connector.name,
    status: configuredStoreStatus(connector, env),
    sourceKind: connector.authorizedFeedEnv
      ? hasConfiguredAuthorizedFeed(connector, env) ? "authorized_feed" : "none"
      : connector.authoritativeStructuredFeed ? "public_structured_feed" : "public_html",
    commercialAlertsEnabled: connector.commercialAlertsEnabled !== false,
    authorizedFeedConfigured: hasConfiguredAuthorizedFeed(connector, env),
    notes: connector.notes
  }));
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function validPreviewAuditToken(request: Request, env: Env): boolean {
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim();
  if (!expected) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const explicit = request.headers.get("x-op-watch-audit-token")?.trim() ?? "";
  const received = bearer || explicit;
  return Boolean(received) && constantTimeEqual(received, expected);
}

async function officialCalendarPreview(now = new Date()) {
  if (calendarPreviewCache && calendarPreviewCache.expiresAt > now.getTime()) {
    return {
      source: calendarPreviewCache.value.source,
      fetchedAt: calendarPreviewCache.value.fetchedAt,
      sourcePages: calendarPreviewCache.value.sourcePages,
      catalogProductsParsed: calendarPreviewCache.value.catalogProducts.length,
      activeProducts: calendarPreviewCache.value.activeProducts
    };
  }

  calendarPreviewLoad ??= loadOfficialCalendar({
    sourceUrl: opWatchV1Config.officialCatalogUrl,
    now,
    daysBefore: opWatchV1Config.watchWindow.daysBeforeRelease,
    daysAfter: opWatchV1Config.watchWindow.daysAfterRelease
  });
  let calendar: Awaited<ReturnType<typeof loadOfficialCalendar>>;
  try {
    calendar = await calendarPreviewLoad;
    calendarPreviewCache = {
      expiresAt: now.getTime() + CALENDAR_PREVIEW_CACHE_MS,
      value: calendar
    };
  } finally {
    calendarPreviewLoad = undefined;
  }
  return {
    source: calendar.source,
    fetchedAt: calendar.fetchedAt,
    sourcePages: calendar.sourcePages,
    catalogProductsParsed: calendar.catalogProducts.length,
    activeProducts: calendar.activeProducts
  };
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
        project: "OP Watch — moteur d'alertes One Piece TCG",
        deployment: mode,
        runtime: {
          cron: false,
          monitoringEnabled: env.MONITORING_ENABLED === "true",
          discordMode: env.DISCORD_MODE ?? "dry-run",
          stateBindingPresent: Boolean(env.TCG_STATE),
          stateWritesEnabled: env.WRITE_STATE === "true",
          authenticatedAuditEnabled: env.ALLOW_PUBLIC_AUDIT === "true" && Boolean(env.PREVIEW_AUDIT_TOKEN),
          automaticPolling: false,
          activeStores: parseActiveStores(env.ACTIVE_STORES),
          schedule: live ? "external scheduler only" : "disabled",
          authorizedFeeds: authorizedFeedReadiness(env)
        },
        v1: {
          mode,
          targetLanguage: opWatchV1Config.language.target,
          strictLanguage: opWatchV1Config.language.strict,
          fastWatchSeconds: opWatchV1Config.polling.fastWatchSeconds,
          discoverySeconds: opWatchV1Config.polling.discoverySeconds,
          watchWindow: opWatchV1Config.watchWindow,
          formats: opWatchV1Config.formats,
          stores: CONNECTORS.map((connector) => connector.key),
          discordProductImages: opWatchV1Config.discord.includeProductImage,
          calendarPreview: "/opwatch/v1/calendar"
        },
        configuration: {
          version: opWatchV1Config.version,
          productSource: "official-calendar-dynamic",
          notifyOnInitialDiscovery: false,
          commercialLanguage: "Français confirmé uniquement"
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
        authorizedFeeds: authorizedFeedReadiness(env),
        stores: storeReadiness(env),
        checkedAt: new Date().toISOString()
      });
    }

    if (url.pathname === "/opwatch/v1/calendar") {
      try {
        return jsonResponse({ mode: "SAFE_CALENDAR_PREVIEW", ...(await officialCalendarPreview()) });
      } catch (error) {
        return jsonResponse({
          mode: "SAFE_CALENDAR_PREVIEW",
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date().toISOString()
        }, 502);
      }
    }

    if (url.pathname === "/config") {
      return jsonResponse({
        version: opWatchV1Config.version,
        opWatchV1: opWatchV1Config,
        alertPolicy: {
          productSource: "official-calendar-dynamic",
          notifyOnInitialDiscovery: false,
          language: "Français confirmé",
          rejectUnknownAvailability: true,
          events: [
            "new_listing",
            "back_in_stock",
            "preorder_opened",
            "became_unavailable",
            "price_drop",
            "price_increase"
          ]
        },
        authorizedFeeds: authorizedFeedReadiness(env),
        stores: storeReadiness(env)
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

    if (!validPreviewAuditToken(request, env)) {
      return jsonResponse({
        error: "Jeton d'audit absent ou invalide.",
        mode
      }, 401);
    }

    const requestedStore = url.searchParams.get("store") as StoreKey | null;
    const selected = selectRequestedConnectors(requestedStore);

    if (requestedStore && selected.length === 0) {
      return jsonResponse({
        error: `Boutique inconnue: ${requestedStore}`,
        allowedStores: CONNECTORS.map((connector) => connector.key)
      }, 400);
    }

    const stores = await runAudits(selected, env);

    if (url.pathname === "/audit") {
      return jsonResponse({
        mode: "READ_ONLY_AUDIT",
        checkedAt: new Date().toISOString(),
        stores
      });
    }

    const calendar = await officialCalendarPreview();
    const candidates = stores
      .flatMap((store) => store.candidates)
      .map((candidate) => candidateForActiveProducts(candidate, calendar.activeProducts))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const evaluation = await evaluateCandidates(candidates, env, {
      config: buildActiveWatchConfig(calendar.activeProducts),
      baselineStores: selected
        .filter((connector) => connector.commercialAlertsEnabled !== false)
        .map((connector) => connector.key)
    });

    return jsonResponse({
      mode: "ALERT_EVALUATION",
      checkedAt: new Date().toISOString(),
      stores,
      evaluation
    });
  }
};
