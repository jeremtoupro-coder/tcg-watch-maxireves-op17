import { afterEach, describe, expect, it, vi } from "vitest";
import { auditConnector } from "../src/audit";
import { CONNECTORS, DEFAULT_CLOUDFLARE_STORES } from "../src/connectors";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

const EXPECTED_STORES = [
  "maxireves",
  "oupi",
  "pixelheart",
  "fantasy-sphere",
  "ludisphere",
  "parkage",
  "ultrajeux",
  "playin",
  "philibert",
  "cultura",
  "micromania",
  "fnac",
  "leclerc",
  "carrefour",
  "king-jouet",
  "joueclub",
  "amazon-fr",
  "mystic-ambre",
  "ludiworld",
  "vegastore",
  "plaza-tcg",
  "otakuland",
  "esprit-jeu",
  "la-grande-recre",
  "bcd-jeux"
];

describe("rollout 25 boutiques", () => {
  it("enregistre exactement les 25 boutiques demandées sans doublon", () => {
    expect(CONNECTORS.map((connector) => connector.key)).toEqual(EXPECTED_STORES);
    expect(new Set(DEFAULT_CLOUDFLARE_STORES).size).toBe(25);
    expect(DEFAULT_CLOUDFLARE_STORES).toEqual(EXPECTED_STORES);
    expect(CONNECTORS.every((connector) => (connector.responseMustContainAny?.length ?? 0) > 0)).toBe(true);
  });

  it("ne contient aucune source hardcodée dupliquée ou non HTTPS", () => {
    const sourceRows = CONNECTORS.flatMap((connector) => connector.sources.map((source) => ({
      store: connector.key,
      source: new URL(source).toString()
    })));
    const duplicates = sourceRows.filter((row, index) =>
      sourceRows.findIndex((candidate) => candidate.source === row.source) !== index
    );

    expect(duplicates).toEqual([]);
    expect(sourceRows.every((row) => new URL(row.source).protocol === "https:")).toBe(true);

    const fantasy = CONNECTORS.find((connector) => connector.key === "fantasy-sphere")!;
    expect(fantasy.sources.filter((source) => /op18/i.test(source))).toHaveLength(5);
    expect(new Set(fantasy.sources).size).toBe(fantasy.sources.length);
  });

  it("refuse une carte marketplace tant que la fiche directe n'est pas relue", async () => {
    const category = "https://market.test/category";
    const product = "https://market.test/op17/a123/w-4";
    const connector: ConnectorDefinition = {
      key: "fnac",
      name: "Fnac",
      sources: [category],
      productUrlPatterns: [/\/a\d+\/w-4/i],
      requiresDirectProductPageForAlerts: true,
      requiredSellerPatterns: [/vendu par fnac/i],
      requiredSellerLabel: "Fnac",
      notes: []
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <a href="${product}" title="Display OP17 Français">Display OP17 Français</a>
      <span>119,90 €</span><span>En stock</span>
    `, { status: 200 })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/fiche produit directe/i);
  });

  it("n'autorise la marketplace qu'après confirmation du vendeur sur la fiche directe", async () => {
    const category = "https://market.test/category";
    const officialProduct = "https://market.test/op17/a123/w-4";
    const partnerProduct = "https://market.test/op17/a456/w-4";
    const connector: ConnectorDefinition = {
      key: "fnac",
      name: "Fnac",
      sources: [category],
      productUrlPatterns: [/\/a\d+\/w-4/i],
      followDiscoveredProductPages: true,
      requiredSellerPatterns: [/vendu par fnac/i],
      requiredSellerLabel: "Fnac",
      requiresDirectProductPageForAlerts: true,
      notes: []
    };

    const categoryHtml = `
      <a href="${officialProduct}" title="Display OP17 Français">Display OP17 Français</a>
      <a href="${partnerProduct}" title="Booster OP17 Français">Booster OP17 Français</a>
    `;
    const officialHtml = `
      <h1>Display OP17 Français</h1><p>119,90 €</p><p>En stock</p><p>Vendu par Fnac</p>
    `;
    const partnerHtml = `
      <h1>Booster OP17 Français</h1><p>8,90 €</p><p>En stock</p><p>Vendu par PartnerShop</p>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url === officialProduct ? officialHtml : url === partnerProduct ? partnerHtml : categoryHtml;
      return new Response(body, { status: 200 });
    }));

    const audit = await auditConnector(connector);
    const official = audit.candidates.find((candidate) => candidate.url === officialProduct);
    const partner = audit.candidates.find((candidate) => candidate.url === partnerProduct);
    expect(official?.sourceUrl).toBe(officialProduct);
    expect(official?.commercialEligible).toBe(true);
    expect(partner?.sourceUrl).toBe(partnerProduct);
    expect(partner?.commercialEligible).toBe(false);
    expect(partner?.commercialEligibilityReason).toMatch(/Fnac non confirmé/i);
  });

  it("conserve le prix affiché sur une fiche directe en rupture", async () => {
    const source = "https://shop.test/produit-32907-st36.html";
    const connector: ConnectorDefinition = {
      key: "test-shop",
      name: "Test Shop",
      sources: [source],
      productUrlPatterns: [/\/produit-\d+-[^?#]+\.html/i],
      responseMustContainAny: [/one[\s-]*piece/i],
      notes: []
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Starter Deck ST-36 Français</h1>
        <p>Prix : 19,90 €</p>
        <p>Rupture de stock</p>
      </body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      availability: "unavailable",
      priceText: "19,90 €"
    });
  });

  it("reste fail-closed si Amazon expédie mais qu'Amazon n'est pas le vendeur", async () => {
    const source = "https://www.amazon.fr/dp/B0ABCDEF12";
    const amazon = CONNECTORS.find((connector) => connector.key === "amazon-fr")!;
    const connector: ConnectorDefinition = { ...amazon, sources: [source] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Display OP-17 Français</h1>
        <p>En stock - 119,90 €</p>
        <p>Vendu par Boutique Tiers</p><p>Expédié par Amazon</p>
      </body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Amazon non confirmé/i);
  });

  it("reste fail-closed si une fiche marketplace mélange vendeur officiel et vendeur tiers", async () => {
    const source = "https://www.amazon.fr/dp/B0ABCDEF12";
    const amazon = CONNECTORS.find((connector) => connector.key === "amazon-fr")!;
    const connector: ConnectorDefinition = { ...amazon, sources: [source] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Display OP-17 Français</h1>
        <p>En stock - 119,90 €</p>
        <p>Vendu par Amazon.fr</p>
        <section>Autre offre : vendu par Boutique Tiers</section>
      </body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Amazon non confirmé/i);
  });

  it("ne télécharge qu'une fois les variantes de tracking d'un même ASIN Amazon", async () => {
    const search = "https://www.amazon.fr/s?k=one+piece+card+game+francais";
    const canonical = "https://www.amazon.fr/dp/B0ABCDEF12";
    const amazon = CONNECTORS.find((connector) => connector.key === "amazon-fr")!;
    const connector: ConnectorDefinition = { ...amazon, sources: [search] };
    const searchHtml = `
      <html><head><title>One Piece Card Game</title></head><body>
        <a href="/Display-One-Piece/dp/B0ABCDEF12?tag=tracking-21&ref_=sr_1_1">Display OP-17 Français</a>
        <a href="/dp/B0ABCDEF12#customerReviews">Display OP-17 Français</a>
        <a href="/gp/product/B0ABCDEF12/ref=s9_acsd_hps_bw_c2_x_1_w">Display OP-17 Français</a>
      </body></html>`;
    const productHtml = `
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Display OP-17 Français</h1>
        <p>En stock - 119,90 €</p><p>Vendu par Amazon.fr</p>
      </body></html>`;
    const calls: string[] = [];

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return new Response(url === search ? searchHtml : productHtml, { status: 200 });
    }));

    const audit = await auditConnector(connector);
    expect(calls).toEqual([search, canonical]);
    expect(audit.sources.map((source) => source.sourceUrl)).toEqual([search, canonical]);
    expect(audit.sources[0].productLinksSeen).toBe(1);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].url).toBe(canonical);
  });

  it("borne chaque audit boutique à 50 sous-requêtes sur le niveau Free", async () => {
    const categories = ["https://shop.test/one-piece-a", "https://shop.test/one-piece-b"];
    const links = Array.from({ length: 60 }, (_, index) =>
      `https://shop.test/produit-${1000 + index}-display-op17-fr.html`
    );
    const connector: ConnectorDefinition = {
      key: "test-shop",
      name: "Test Shop",
      sources: categories,
      productUrlPatterns: [/\/produit-\d+-[^?#]+\.html/i],
      followDiscoveredProductPages: true,
      maxDiscoveredProductPages: 50,
      maxConcurrency: 6,
      responseMustContainAny: [/one[\s-]*piece/i],
      notes: []
    };
    const categoryHtml = `<html><body><h1>One Piece Card Game</h1>${links
      .map((url) => `<a href="${url}">Display OP17 Français</a>`)
      .join("")}</body></html>`;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return new Response(categories.includes(url)
        ? categoryHtml
        : "<html><body><h1>One Piece Display OP17 Français</h1><p>En stock</p></body></html>",
      { status: 200 });
    }));

    const audit = await auditConnector(connector);

    expect(calls).toHaveLength(50);
    expect(audit.sources).toHaveLength(50);
    expect(calls.slice(0, 2)).toEqual(categories);
  });

  it("borne aussi une configuration contenant plus de 50 sources initiales", async () => {
    const sources = Array.from({ length: 52 }, (_, index) => `https://shop.test/source-${index}`);
    const connector: ConnectorDefinition = {
      key: "test-shop",
      name: "Test Shop",
      sources,
      productUrlPatterns: [/\/produit\//i],
      followDiscoveredProductPages: false,
      maxConcurrency: 6,
      responseMustContainAny: [/one[\s-]*piece/i],
      notes: []
    };
    const fetchMock = vi.fn(async () => new Response(
      "<html><body><h1>One Piece Card Game</h1></body></html>",
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditConnector(connector);

    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(audit.sources).toHaveLength(50);
    expect(audit.warnings?.[0]).toMatch(/2 sources.*50 sous-requêtes/i);
  });
});
