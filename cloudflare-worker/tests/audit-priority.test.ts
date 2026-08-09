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

  it("suit une fiche Oupi découverte et lui donne priorité sans devoir connaître son URL à l'avance", async () => {
    const categoryUrl = "https://oupi.test/fr/413-precommande-one-piece";
    const productUrl = "https://oupi.test/fr/display-one-piece/7367-display-op-17-francais.html";
    const connector: ConnectorDefinition = {
      key: "oupi",
      name: "Oupi",
      sources: [categoryUrl],
      productUrlPatterns: [/\/\d+-[^/?#]+\.html$/i],
      followDiscoveredProductPages: true,
      maxDiscoveredProductPages: 8,
      notes: []
    };

    const categoryHtml = `
      <article>
        <a href="${productUrl}" title="Display OP-17 Boite de Booster (Français)">
          Display OP-17 Boite de Booster (Français)
        </a>
        <p>Précommande ouverte</p><span>119,80 €</span>
      </article>
    `;
    const productHtml = `
      <h1>Display OP-17 Boite de Booster (Français)</h1>
      <span>119,80 €</span>
      <div>Rupture de stock</div>
      <p>Précommande : disponibilité août 2026.</p>
      <dl><dt>Langue</dt><dd>Français</dd></dl>
    `;

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(url === productUrl ? productHtml : categoryHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditConnector(connector);
    const candidate = audit.candidates.find((item) => item.url === productUrl);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.sources.map((source) => source.sourceUrl)).toContain(productUrl);
    expect(candidate?.sourceUrl).toBe(productUrl);
    expect(candidate?.availability).toBe("unavailable");
    expect(candidate?.language).toBe("Français confirmé");
  });

  it("privilégie la langue structurée du produit malgré une phrase erronée et des produits liés en anglais", async () => {
    const productUrl = "https://oupi.test/fr/case-scelle-de-display/7368-case-op-17-francais.html";
    const connector: ConnectorDefinition = {
      key: "oupi",
      name: "Oupi",
      sources: [productUrl],
      productUrlPatterns: [/\/\d+-[^/?#]+\.html$/i],
      notes: []
    };

    const html = `
      <h1>Case Scellée de 12 Display OP-17 (Français) - One Piece Card Game</h1>
      <div>Rupture de stock</div>
      <p>Découvrez ce carton de boosters en Anglais du jeu One Piece.</p>
      <section class="product-features">
        <span>Fiche technique</span>
        <dl><dt>Langue</dt><dd>Français</dd></dl>
      </section>
      <h2>16 autres produits dans la même catégorie :</h2>
      <a href="/9999-other.html">Display OP-12 (Anglais)</a>
    `;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" }
    })));

    const audit = await auditConnector(connector);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].language).toBe("Français confirmé");
    expect(audit.candidates[0].availability).toBe("unavailable");
  });

  it("applique le profil HTTP explicite du connecteur au lieu d'imiter un navigateur", async () => {
    const categoryUrl = "https://oupi.test/fr/413-precommande-one-piece";
    const connector: ConnectorDefinition = {
      key: "oupi",
      name: "Oupi",
      sources: [categoryUrl],
      productUrlPatterns: [/\.html$/i],
      requestHeaders: {
        "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)"
      },
      notes: []
    };

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("user-agent")).toBe("OPWatch/1.0 (+personal read-only stock monitor)");
      expect(headers.get("user-agent")).not.toMatch(/Mozilla\/5\.0/i);
      return new Response("<html><body>One Piece</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditConnector(connector);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.sources[0].status).toBe(200);
  });

  it("conserve un HTTP 403 comme erreur de source et ne fabrique aucun état de stock", async () => {
    const connector: ConnectorDefinition = {
      key: "oupi",
      name: "Oupi",
      sources: ["https://oupi.test/fr/413-precommande-one-piece"],
      productUrlPatterns: [/\.html$/i],
      notes: []
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));

    const audit = await auditConnector(connector);
    expect(audit.sources[0].error).toBe("HTTP 403");
    expect(audit.sources[0].candidates).toEqual([]);
    expect(audit.candidates).toEqual([]);
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
