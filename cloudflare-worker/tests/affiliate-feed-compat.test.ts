import { afterEach, describe, expect, it, vi } from "vitest";
import { auditAuthorizedFeed } from "../src/authorizedFeed";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function connector(key: string, name: string, overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    key,
    name,
    sources: [],
    productUrlPatterns: [/./],
    notes: [],
    ...overrides
  };
}

describe("affiliate product-feed compatibility", () => {
  it("ingests the core Awin publisher feed columns without a shop-specific parser", async () => {
    const csv = [
      "product_name,aw_deep_link,search_price,merchant_image_url,in_stock,language,merchant_name,merchant_product_id",
      "One Piece OP17 Display FR,https://merchant.example/op17?awc=publisher,119.90,https://img.example/op17.jpg,1,français,Cultura,SKU-OP17-FR"
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(
      connector("cultura", "Cultura"),
      "https://productdata.example/awin-cultura.csv"
    );

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      store: "cultura",
      title: "One Piece OP17 Display FR",
      url: "https://merchant.example/op17?awc=publisher",
      availability: "available",
      language: "Français confirmé",
      seller: "Cultura",
      externalId: "SKU-OP17-FR",
      priceText: "119.90 €",
      imageUrl: "https://img.example/op17.jpg",
      commercialEligible: true
    });
  });

  it("keeps marketplace seller gating when the authorized Awin feed is used", async () => {
    const csv = [
      "product_name,aw_deep_link,search_price,in_stock,language,merchant_name,merchant_product_id",
      "One Piece OP17 Display FR,https://fnac.example/op17?awc=publisher,129.90,1,français,Vendeur Tiers,SKU-OP17"
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(
      connector("fnac", "Fnac", {
        requiredSellerPatterns: [/\bfnac\b/i],
        requiredSellerLabel: "Fnac"
      }),
      "https://productdata.example/awin-fnac.csv"
    );

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Fnac non confirmé/i);
  });

  it("ingests a minimal Kwanko custom CSV using OP Watch canonical columns", async () => {
    const csv = [
      "title;url;price;stock;language;image;seller;id",
      "One Piece OP17 Display FR;https://merchant.example/op17?k=tracking;114.90;disponible;français;https://img.example/op17.jpg;Carrefour;EAN-OP17"
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(
      connector("carrefour", "Carrefour", {
        requiredSellerPatterns: [/\bcarrefour\b/i],
        requiredSellerLabel: "Carrefour"
      }),
      "https://catalog.example/kwanko-carrefour.csv"
    );

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      store: "carrefour",
      availability: "available",
      language: "Français confirmé",
      seller: "Carrefour",
      commercialEligible: true
    });
  });

  it("ingests an Affilae-style comparator product feed for Playin", async () => {
    const csv = [
      "Product Name;Product URL;Price;Stock;Image URL;EAN;Brand;Description",
      "One Piece OP17 Display FR;https://playin.example/op17?aff=publisher;109.90;12;https://img.example/playin-op17.jpg;3700000OP17;Bandai;Display One Piece Card Game OP-17 français"
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(
      connector("playin", "Playin"),
      "https://catalog.example/affilae-playin.csv"
    );

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      store: "playin",
      title: "One Piece OP17 Display FR",
      availability: "available",
      language: "Français confirmé",
      externalId: "3700000OP17",
      priceText: "109.90 €",
      imageUrl: "https://img.example/playin-op17.jpg",
      commercialEligible: true
    });
  });
});
