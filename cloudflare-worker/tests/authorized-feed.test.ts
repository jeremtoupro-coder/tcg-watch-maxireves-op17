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
});
