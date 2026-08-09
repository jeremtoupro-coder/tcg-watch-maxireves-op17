import { auditConnector } from "./audit";
import { WATCH_CONFIG } from "./config";
import { CONNECTORS } from "./connectors";
import { evaluateCandidates } from "./engine";
import { parseActiveStores, runMonitoringCycle } from "./monitor";
import opWatchV1Config from "../config/opwatch-v1.json";
import { activeOfficialProducts, computeWatchWindow, parseOfficialCatalog } from "./opwatchV1";
import { probeOupiFromWorker } from "./oupiProbe";
import type { ConnectorDefinition, Env, StoreKey } from "./types";

const BROWSER_PROBE_TARGETS: Record<string, string> = {
  playin: "https://www.play-in.com/fr/produit/646300/display-de-24-boosters-op-16-l-heure-de-la-bataille-decisive-one-piece-fr",
  cultura: "https://www.cultura.com/p-booster-one-piece-op16-l-heure-de-la-bataille-decisive-13080126.html",
  fnac: "https://www.fnac.com/Cartes-a-collectionner-One-Piece-OP16-Booster-Double-Pack/a23123806/w-4",
  carrefour: "https://www.carrefour.fr/p/cartes-booster-one-piece-op14-les-sept-de-la-mer-d-azur-bandai-4582769923166",
  "king-jouet": "https://www.king-jouet.com/jeu-jouet/jeux-societes/cartes-a-collectionner/ref-1034904-cartes-one-piece-double-booster-op16-heure-de-la-bataille-decisive.htm",
  otakuland: "https://otakuland.fr/shop/"
};

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

async function browserProbe(store: string, env: Env) {
  if (!env.BROWSER) throw new Error("Binding Browser Run absent.");
  const target = BROWSER_PROBE_TARGETS[store];
  if (!target) throw new Error(`Boutique non autorisée pour le probe navigateur: ${store}`);

  const response = await env.BROWSER.quickAction("content", {
    url: target,
    gotoOptions: {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    },
    rejectResourceTypes: ["image", "media", "font"]
  });
  const raw = await response.text();
  let html = raw;
  try {
    const parsed = JSON.parse(raw) as { result?: unknown };
    if (typeof parsed.result === "string") html = parsed.result;
  } catch {
    // Certaines versions du binding peuvent renvoyer directement le HTML.
  }

  return {
    store,
    target,
    browserResponseStatus: response.status,
    browserResponseOk: response.ok,
    browserMsUsed: response.headers.get("x-browser-ms-used"),
    bytes: html.length,
    hasOnePiece: /one[\s-]*piece/i.test(html),
    hasOpCode: /\b(?:OP|EB|PRB|ST|DP)[-\s]?\d{1,2}\b/i.test(html),
    hasChallenge: /captcha|verify you are human|access denied|challenge-platform|cf-chl/i.test(html),
    textPrefix: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 350)
  };
}

async function officialCalendarPreview(now = new Date()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(opWatchV1Config.officialCatalogUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch/1.0 (+read-only release calendar)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`Official catalog HTTP ${response.status}`);
    const html = await response.text();
    const products = parseOfficialCatalog(html);
    if (products.length === 0) {
      throw new Error("Le catalogue officiel a répondu mais aucun produit daté n'a été reconnu.");
    }
    const active = activeOfficialProducts(
      products,
      now,
      opWatchV1Config.watchWindow.daysBeforeRelease,
      opWatchV1Config.watchWindow.daysAfterRelease
    );
    return {
      source: opWatchV1Config.officialCatalogUrl,
      fetchedAt: now.toISOString(),
      catalogProductsParsed: products.length,
      activeProducts: active.map((product) => ({
        ...product,
        watchWindow: computeWatchWindow(
          product.releaseDate,
          now,
          opWatchV1Config.watchWindow.daysBeforeRelease,
          opWatchV1Config.watchWindow.daysAfterRelease
        )
      }))
    };
  } finally {
    clearTimeout(timeout);
  }
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
        v1: {
          mode: opWatchV1Config.mode,
          targetLanguage: opWatchV1Config.language.target,
          strictLanguage: opWatchV1Config.language.strict,
          fastWatchSeconds: opWatchV1Config.polling.fastWatchSeconds,
          discoverySeconds: opWatchV1Config.polling.discoverySeconds,
          watchWindow: opWatchV1Config.watchWindow,
          formats: opWatchV1Config.formats,
          pilotStores: opWatchV1Config.pilotStores.filter((store) => store.enabled).map((store) => store.id),
          discordProductImages: opWatchV1Config.discord.includeProductImage,
          calendarPreview: "/opwatch/v1/calendar"
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
          protectedRoutes: ["/audit", "/evaluate", "/opwatch/v1/browser-probe"],
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

    if (url.pathname === "/opwatch/v1/oupi-probe") {
      if (live) {
        return jsonResponse({ error: "Probe interdit en mode LIVE." }, 403);
      }
      return jsonResponse({
        mode: "SAFE_OUPI_RUNTIME_PROBE",
        checkedAt: new Date().toISOString(),
        results: await probeOupiFromWorker()
      });
    }

    if (url.pathname === "/opwatch/v1/oupi-audit") {
      if (live) {
        return jsonResponse({ error: "Audit Oupi interdit en mode LIVE." }, 403);
      }
      const connector = CONNECTORS.find((item) => item.key === "oupi");
      if (!connector) return jsonResponse({ error: "Connecteur Oupi introuvable." }, 500);
      const audit = await auditConnector(connector);
      return jsonResponse({
        mode: "SAFE_OUPI_CONNECTOR_AUDIT",
        checkedAt: new Date().toISOString(),
        audit
      });
    }

    if (url.pathname === "/opwatch/v1/browser-probe") {
      if (live || env.ALLOW_PUBLIC_AUDIT !== "true") {
        return jsonResponse({ error: "Browser probe désactivé." }, 403);
      }
      const store = url.searchParams.get("store") ?? "";
      if (!BROWSER_PROBE_TARGETS[store]) {
        return jsonResponse({
          error: `Boutique non autorisée: ${store}`,
          allowedStores: Object.keys(BROWSER_PROBE_TARGETS)
        }, 400);
      }
      try {
        return jsonResponse({
          mode: "SAFE_BROWSER_RUN_PROBE",
          checkedAt: new Date().toISOString(),
          result: await browserProbe(store, env)
        });
      } catch (error) {
        return jsonResponse({
          mode: "SAFE_BROWSER_RUN_PROBE",
          store,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        }, 502);
      }
    }

    if (url.pathname === "/config") {
      return jsonResponse({
        version: WATCH_CONFIG.version,
        settings: WATCH_CONFIG.settings,
        products: WATCH_CONFIG.products,
        alerts: WATCH_CONFIG.alerts,
        opWatchV1: opWatchV1Config
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
