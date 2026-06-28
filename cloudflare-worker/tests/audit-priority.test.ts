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
});
