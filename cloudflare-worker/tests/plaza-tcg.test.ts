import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateAlertRules } from "../src/alerts";
import { auditConnector } from "../src/audit";
import { CONNECTORS } from "../src/connectors";
import { buildDiscordPayloads } from "../src/discord";
import { runMonitoringCycle } from "../src/monitor";
import { MemoryStateStore, processCandidates } from "../src/state";
import type { ProductCandidate } from "../src/types";
import { TEST_OP17, TEST_WATCH_CONFIG } from "./testConfig";

afterEach(() => vi.unstubAllGlobals());

const PLAZA_OP17_URL = "https://plazatcg.com/display/2189-one-piece-display-les-guerriers-les-plus-puissants-au-monde-op17-francais-4582770058710.html";
const PLAZA_CATEGORY_URL = "https://plazatcg.com/5-one-piece";
const PLAZA_HOME_URL = "https://plazatcg.com/";
const PLAZA_NEW_OP17_URL = "https://plazatcg.com/display/2199-one-piece-display-op17-francais-precommande.html";

function plazaCandidate(availability: ProductCandidate["availability"]): ProductCandidate {
  return {
    store: "plaza-tcg",
    storeName: "Plaza TCG",
    title: "One Piece - Display - Les guerriers les plus puissants au monde - OP17 - Français",
    url: PLAZA_OP17_URL,
    sourceUrl: PLAZA_OP17_URL,
    matchedReferences: ["OP-17"],
    format: "display",
    availability,
    language: "Français confirmé",
    priceText: "199,99 €",
    imageUrl: "https://plazatcg.com/img/op17-fr.jpg",
    commercialEligible: true,
    excerpt: "Display OP17 Français 199,99 €",
  };
}

function unavailableProductHtml(): string {
  return `
    <html><head>
      <title>One Piece OP17 Français - Plaza TCG</title>
      <meta property="og:image" content="https://plazatcg.com/img/op17-fr.jpg">
    </head><body>
      <h1>One Piece - Display - Les guerriers les plus puissants au monde - OP17 - Français</h1>
      <p>199,99 €</p>
      <p>Rupture de stock</p>
    </body></html>`;
}

function categoryHtml(productUrl = PLAZA_OP17_URL): string {
  return `
    <html><head><title>One Piece - Plaza TCG</title></head><body>
      <h1>Nos produits One Piece</h1>
      <a href="${productUrl}">One Piece Display OP17 Français</a>
      <span>199,99 €</span><span>INDISPONIBLE</span>
    </body></html>`;
}

describe("Plaza TCG", () => {
  it("qualifie la fiche OP17 FR directe avant toute alerte commerciale", async () => {
    const plaza = CONNECTORS.find((connector) => connector.key === "plaza-tcg");
    expect(plaza).toBeDefined();

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(url === PLAZA_OP17_URL ? unavailableProductHtml() : categoryHtml(), { status: 200 });
    }));

    const audit = await auditConnector(plaza!);
    const op17 = audit.candidates.find((candidate) => candidate.url === PLAZA_OP17_URL);

    expect(op17).toMatchObject({
      store: "plaza-tcg",
      storeName: "Plaza TCG",
      availability: "unavailable",
      language: "Français confirmé",
      priceText: "199,99 €",
      format: "display",
      commercialEligible: true,
      sourceUrl: PLAZA_OP17_URL,
    });
  });

  it("transforme un retour en stock Plaza TCG en alerte Discord avec le bon lien", async () => {
    const state = new MemoryStateStore();
    await processCandidates([plazaCandidate("unavailable")], state, {
      writeState: true,
      now: "2026-08-21T10:00:00.000Z",
    });

    const changed = await processCandidates([plazaCandidate("available")], state, {
      writeState: true,
      now: "2026-08-21T10:01:00.000Z",
    });
    const matches = evaluateAlertRules(changed.changes, TEST_WATCH_CONFIG);
    const payloads = buildDiscordPayloads(matches);

    expect(matches).toHaveLength(1);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].embeds[0].title).toContain("Retour en stock");
    expect(payloads[0].embeds[0].url).toBe(PLAZA_OP17_URL);
    expect(payloads[0].embeds[0].fields).toContainEqual({
      name: "🏪 Boutique",
      value: "Plaza TCG",
      inline: true,
    });
  });

  it("relit accueil + catégorie à la minute et alerte si Plaza remplace l'URL OP17 au lancement", async () => {
    const state = new MemoryStateStore({ writable: true });
    let launchOpened = false;
    const calls: string[] = [];

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === PLAZA_OP17_URL) return new Response(unavailableProductHtml(), { status: 200 });
      if (url === PLAZA_NEW_OP17_URL) {
        return new Response(`
          <html><head><title>One Piece OP17 Français - Plaza TCG</title></head><body>
            <h1>One Piece - Display - OP17 - Français - Précommande</h1>
            <p>189,99 €</p><p>Précommande ouverte</p>
          </body></html>`, { status: 200 });
      }
      if (url === PLAZA_CATEGORY_URL || url === PLAZA_HOME_URL) {
        return new Response(categoryHtml(launchOpened ? PLAZA_NEW_OP17_URL : PLAZA_OP17_URL), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }));

    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "plaza-tcg"
    };

    const baseline = await runMonitoringCycle(env, {
      officialProducts: [TEST_OP17],
      officialCatalogProductIds: ["OP-17"],
      stateStore: state,
      forceDiscovery: true,
      scheduledTime: Date.UTC(2026, 7, 21, 13, 0, 0)
    });
    expect(baseline.evaluation?.alertMatches).toEqual([]);

    calls.length = 0;
    launchOpened = true;
    const launch = await runMonitoringCycle(env, {
      officialProducts: [TEST_OP17],
      officialCatalogProductIds: ["OP-17"],
      stateStore: state,
      scheduledTime: Date.UTC(2026, 7, 21, 13, 1, 0)
    });

    expect(calls).toContain(PLAZA_OP17_URL);
    expect(calls).toContain(PLAZA_CATEGORY_URL);
    expect(calls).toContain(PLAZA_HOME_URL);
    expect(calls).toContain(PLAZA_NEW_OP17_URL);
    expect(launch.evaluation?.alertMatches).toHaveLength(1);
    expect(launch.evaluation?.alertMatches[0].change.type).toBe("new_listing");
    expect(launch.evaluation?.discordDispatch.attempted).toBe(1);
    expect(launch.evaluation?.discordPayloads[0].embeds[0].url).toBe(PLAZA_NEW_OP17_URL);
  });
});
