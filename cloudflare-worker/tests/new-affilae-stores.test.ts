import { afterEach, describe, expect, it, vi } from "vitest";
import { auditConnector } from "../src/audit";
import { bcdJeux } from "../src/connectors/bcdJeux";
import { espritJeu } from "../src/connectors/espritJeu";
import { laGrandeRecre } from "../src/connectors/laGrandeRecre";

afterEach(() => vi.unstubAllGlobals());

describe("nouveaux marchands Affilae", () => {
  it.each([
    {
      connector: espritJeu,
      product: "https://www.espritjeu.com/one-piece-display-de-24-boosters-op17-les-guerriers-les-plus-puissants-du-monde.html",
      categoryHtml: '<html><body>One Piece Card Game <a href="https://www.espritjeu.com/one-piece-display-de-24-boosters-op17-les-guerriers-les-plus-puissants-du-monde.html">Display OP17</a></body></html>',
      productHtml: '<html><body><h1>One Piece - Display de 24 boosters - OP17 Français</h1><p>179,90 €</p><p>En Stock</p><p>Langue(s) Français</p></body></html>'
    },
    {
      connector: laGrandeRecre,
      product: "https://www.lagranderecre.fr/jeux-de-societe/cartes-a-collectionner/booster-one-piece-op17-les-guerriers-les-plus-puissants.html",
      categoryHtml: '<html><body>One Piece Card Game <a href="https://www.lagranderecre.fr/jeux-de-societe/cartes-a-collectionner/booster-one-piece-op17-les-guerriers-les-plus-puissants.html">Booster One Piece OP17</a></body></html>',
      productHtml: '<html><body><h1>BOOSTER ONE PIECE OP17 FRANÇAIS</h1><p>6,99 €</p><p>LIVRAISON : DISPONIBLE</p></body></html>'
    },
    {
      connector: bcdJeux,
      product: "https://www.bcd-jeux.fr/one-piece-tcg/39999-one-piece-op17-display-24-boosters-fr-4580000000000.html",
      categoryHtml: '<html><body>One Piece TCG <a href="https://www.bcd-jeux.fr/one-piece-tcg/39999-one-piece-op17-display-24-boosters-fr-4580000000000.html">Display One Piece OP17 FR</a></body></html>',
      productHtml: '<html><body><h1>One Piece : OP17 - Display 24 boosters Français</h1><p>179,90 € TTC</p><p>Edition française</p><p>En Stock, Expédié sous 24h</p></body></html>'
    }
  ])("qualifie $connector.name via catégorie puis fiche directe", async ({ connector, product, categoryHtml, productHtml }) => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(url === product ? productHtml : categoryHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }));

    const audit = await auditConnector(connector);
    const candidate = audit.candidates.find((item) => item.url === product);

    expect(audit.sources.every((source) => !source.error)).toBe(true);
    expect(candidate).toBeDefined();
    expect(candidate?.matchedReferences).toContain("OP-17");
    expect(candidate?.language).toBe("Français confirmé");
    expect(candidate?.availability).toBe("available");
    expect(candidate?.commercialEligible).toBe(true);
  });

  it("limite La Grande Récré aux fiches One Piece de la catégorie TCG", () => {
    const [pattern] = laGrandeRecre.productUrlPatterns;
    expect(pattern.test("https://www.lagranderecre.fr/jeux-de-societe/cartes-a-collectionner/booster-one-piece-op17.html")).toBe(true);
    expect(pattern.test("https://www.lagranderecre.fr/jeux-de-societe/cartes-a-collectionner/booster-pokemon-me05.html")).toBe(false);
  });
});
