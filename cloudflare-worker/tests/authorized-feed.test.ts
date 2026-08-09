import { afterEach, describe, expect, it, vi } from "vitest";
import { auditAuthorizedFeed, parseAuthorizedFeed } from "../src/authorizedFeed";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function connector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    key: "playin",
    name: "Playin",
    sources: [],
    productUrlPatterns: [/./],
    notes: [],
    ...overrides
  };
}

describe("flux produits autorisés", () => {
  it("parse un CSV personnalisable", () => {
    const rows = parseAuthorizedFeed(`title;url;price;stock;language\nOne Piece OP17 Display FR;https://shop.test/op17;119,90;disponible;français`, "text/csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toMatch(/OP17/);
  });

  it("parse JSON et XML", () => {
    expect(parseAuthorizedFeed(JSON.stringify({ products: [{ title: "OP17 Booster", url: "https://x.test/op17" }] }), "application/json")).toHaveLength(1);
    expect(parseAuthorizedFeed(`<products><product><title>OP17 Booster</title><url>https://x.test/op17</url></product></products>`, "application/xml")).toHaveLength(1);
  });

  it("parse aussi un TSV avec champs usuels", () => {
    const rows = parseAuthorizedFeed(
      "name\tproduct_url\tsale_price\tin_stock\tlang\tean\nDisplay OP17 FR\thttps://shop.test/op17\t119.90\ttrue\tfr\t1234567890123",
      "text/tab-separated-values"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Display OP17 FR", ean: "1234567890123" });
  });

  it("interprète une quantité de stock numérique positive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,https://shop.test/op17,119.90,12,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(audit.candidates[0].availability).toBe("available");
  });

  it("convertit un flux en candidat FR sans exposer l'URL secrète", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,image_url\nOne Piece OP17 Display FR,https://shop.test/op17,119.90,en stock,français,https://img.test/op17.jpg`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector(), "https://secret-feed.test/token-123.csv");
    expect(audit.sources[0].sourceUrl).toBe("authorized-feed:playin");
    expect(JSON.stringify(audit)).not.toContain("token-123");
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      language: "Français confirmé",
      availability: "available",
      commercialEligible: true
    });
  });

  it("reste fail-closed pour une marketplace sans vendeur officiel confirmé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://fnac.test/op17,149.90,disponible,français,Vendeur Tiers`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector({
      key: "fnac",
      name: "Fnac",
      requiredSellerPatterns: [/\bfnac\b/i],
      requiredSellerLabel: "Fnac"
    }), "https://secret-feed.test/fnac.csv");

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Fnac non confirmé/i);
  });

  it("accepte la marketplace lorsque le vendeur officiel est explicitement présent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://fnac.test/op17,149.90,disponible,français,Fnac`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector({
      key: "fnac",
      name: "Fnac",
      requiredSellerPatterns: [/\bfnac\b/i],
      requiredSellerLabel: "Fnac"
    }), "https://secret-feed.test/fnac.csv");

    expect(audit.candidates[0].commercialEligible).toBe(true);
  });

  it("refuse un flux secret non chiffré avant toute requête", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const audit = await auditAuthorizedFeed(connector(), "http://feed.example/playin.csv");
    expect(audit.sources[0].error).toMatch(/HTTPS/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignore une ligne dont le lien produit n'est pas HTTP(S)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,javascript:alert(1),119.90,en stock,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(audit.candidates).toEqual([]);
  });

  it("refuse les destinations locales et les liens produits non chiffrés", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const privateAudit = await auditAuthorizedFeed(connector(), "https://127.0.0.1/feed.csv");
    expect(privateAudit.sources[0].error).toMatch(/HTTPS/i);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,http://shop.test/op17,119.90,en stock,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const productAudit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(productAudit.candidates).toEqual([]);
  });

  it("ne répercute jamais une URL secrète contenue dans une erreur réseau", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connexion refusée vers https://secret-feed.test/token-123.csv");
    }));
    const audit = await auditAuthorizedFeed(connector(), "https://secret-feed.test/token-123.csv");
    expect(audit.sources[0].error).toBe("Flux autorisé: échec réseau sans détail sensible");
    expect(JSON.stringify(audit)).not.toContain("token-123");
  });
});
