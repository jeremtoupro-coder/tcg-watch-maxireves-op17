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
  "otakuland"
];

describe("rollout 21 boutiques", () => {
  it("enregistre exactement les 21 boutiques demandées sans doublon", () => {
    expect(CONNECTORS.map((connector) => connector.key)).toEqual(EXPECTED_STORES);
    expect(new Set(DEFAULT_CLOUDFLARE_STORES).size).toBe(21);
    expect(DEFAULT_CLOUDFLARE_STORES).toEqual(EXPECTED_STORES);
    expect(CONNECTORS.every((connector) => (connector.responseMustContainAny?.length ?? 0) > 0)).toBe(true);
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
});
