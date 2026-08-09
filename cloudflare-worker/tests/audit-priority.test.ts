import { afterEach, describe, expect, it, vi } from "vitest";
import { auditConnector } from "../src/audit";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("priorité de la fiche produit", () => {
  it("conserve la rupture de la fiche directe face à une carte de catégorie en précommande", async () => {
    const categoryUrl = "https://example.test/category";
    const productUrl = "https://example.test/op-17-french.html";
    const connector: ConnectorDefinition = {
      key: "oupi",
      name: "Oupi",
      sources: [categoryUrl, productUrl],
      productUrlPatterns: [/\.html$/i],
      maxConcurrency: 2,
      notes: []
    };

    const categoryHtml = `
      <a href="${productUrl}" title="OP-17 Booster Box (French)">OP-17 Booster Box (French)</a>
      <p>Pre-order now</p><span>119,76 €</span>
    `;
    const productHtml = `
      <h1>OP-17 Booster Box (French)</h1>
      <span>99,80 €</span><strong>Out of Stock</strong>
      <p>Pre-order: availability August 2026.</p>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url === productUrl ? productHtml : categoryHtml;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }));

    const audit = await auditConnector(connector);
    const candidate = audit.candidates.find((item) => item.url === productUrl);

    expect(candidate?.availability).toBe("unavailable");
    expect(candidate?.sourceUrl).toBe(productUrl);
  });

  it("ignore un bouton add-to-cart WooCommerce qui hérite de l'URL OP17 mais cible un autre produit", async () => {
    const productUrl = "https://example.test/produit/display-op17-fr/";
    const connector: ConnectorDefinition = {
      key: "pixelheart",
      name: "PixelHeart",
      sources: [productUrl],
      productUrlPatterns: [/\/produit\//i],
      notes: []
    };

    const html = `
      <html><head><meta property="og:image" content="/op17.jpg"></head><body>
        <h1>Display OP17 Version Française</h1>
        <p>Précommande 249,90 &euro;</p>
        <a href="${productUrl}?add-to-cart=999" aria-label="Ajouter au panier : Pokemon unrelated">
          Ajouter au panier : Pokemon unrelated
        </a>
      </body></html>
    `;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" }
    })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].url).toBe(productUrl);
    expect(audit.candidates[0].title).toBe("Display OP17 Version Française");
    expect(audit.candidates[0].priceText).toBe("249,90 €");
  });
});
