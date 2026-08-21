import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateAlertRules } from "../src/alerts";
import { auditConnector } from "../src/audit";
import { CONNECTORS } from "../src/connectors";
import { buildDiscordPayloads } from "../src/discord";
import { MemoryStateStore, processCandidates } from "../src/state";
import type { ProductCandidate } from "../src/types";
import { TEST_WATCH_CONFIG } from "./testConfig";

afterEach(() => vi.unstubAllGlobals());

const PLAZA_OP17_URL = "https://plazatcg.com/display/2189-one-piece-display-les-guerriers-les-plus-puissants-au-monde-op17-francais-4582770058710.html";

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

describe("Plaza TCG", () => {
  it("qualifie la fiche OP17 FR directe avant toute alerte commerciale", async () => {
    const plaza = CONNECTORS.find((connector) => connector.key === "plaza-tcg");
    expect(plaza).toBeDefined();

    const categoryUrl = "https://plazatcg.com/5-one-piece";
    const categoryHtml = `
      <html><head><title>One Piece - Plaza TCG</title></head><body>
        <a href="${PLAZA_OP17_URL}">One Piece Display OP17 Français</a>
        <span>199,99 €</span><span>INDISPONIBLE</span>
      </body></html>`;
    const productHtml = `
      <html><head>
        <title>One Piece OP17 Français - Plaza TCG</title>
        <meta property="og:image" content="https://plazatcg.com/img/op17-fr.jpg">
      </head><body>
        <h1>One Piece - Display - Les guerriers les plus puissants au monde - OP17 - Français</h1>
        <p>199,99 €</p>
        <p>Rupture de stock</p>
      </body></html>`;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(url === categoryUrl ? categoryHtml : productHtml, { status: 200 });
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
});
