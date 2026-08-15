import { describe, expect, it } from "vitest";
import {
  activeOfficialProducts,
  aliasesForProduct,
  buildActiveWatchConfig,
  candidateForActiveProducts,
  canonicalProductCode,
  computeWatchWindow,
  detectFrenchListing,
  detectProductFormat,
  extractProductImage,
  listingIdentity,
  parseOfficialCatalog,
  qualifyListing,
  type OfficialProduct
} from "../src/opwatchV1";

const OP17: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER PACK OP-17",
  releaseDate: "2026-08-28",
  aliases: aliasesForProduct("OP-17")
};

const EB05: OfficialProduct = {
  id: "EB-05",
  family: "EB",
  label: "EXTRA BOOSTER EB-05",
  releaseDate: "2026-12-18",
  aliases: aliasesForProduct("EB-05")
};

describe("OP Watch V1 - calendrier officiel", () => {
  it("normalise toutes les écritures usuelles d'une référence", () => {
    expect(canonicalProductCode("OP17")).toBe("OP-17");
    expect(canonicalProductCode("op-7")).toBe("OP-07");
    expect(canonicalProductCode("EB 05")).toBe("EB-05");
    expect(canonicalProductCode("PRB03")).toBe("PRB-03");
    expect(canonicalProductCode("ST-31")).toBe("ST-31");
  });

  it("calcule strictement la fenêtre J-120 / J+30", () => {
    expect(computeWatchWindow("2026-08-28", new Date("2026-04-30T12:00:00Z")).active).toBe(true);
    expect(computeWatchWindow("2026-08-28", new Date("2026-04-28T10:00:00Z")).active).toBe(false);
    expect(computeWatchWindow("2026-08-28", new Date("2026-09-27T12:00:00Z")).active).toBe(true);
    expect(computeWatchWindow("2026-08-28", new Date("2026-09-28T13:00:00Z")).active).toBe(false);
  });

  it("ne conserve que les produits dans leur fenêtre de surveillance", () => {
    expect(activeOfficialProducts([OP17, EB05], new Date("2026-08-09T12:00:00Z")).map((p) => p.id)).toEqual(["OP-17"]);
  });

  it("parse un extrait réaliste du catalogue officiel sans attribuer une date absente", () => {
    const html = `
      <section><h3>BOOSTER PACK -TEST- [OP-17]</h3><p>Release Date August 28, 2026</p></section>
      <section><h3>STARTER DECK [ST-31]</h3><p>Release Date July 31, 2026</p></section>
      <section><h3>EXTRA BOOSTER [EB-05]</h3><p>Date coming soon</p></section>
    `;
    const parsed = parseOfficialCatalog(html);
    expect(parsed.map((p) => [p.id, p.releaseDate])).toEqual([
      ["ST-31", "2026-07-31"],
      ["OP-17", "2026-08-28"]
    ]);
  });

  it("parse aussi une date officielle française", () => {
    const parsed = parseOfficialCatalog(`
      <article>BOOSTER [OP-17] Date de sortie 28 août 2026</article>
      <article>EXTRA BOOSTER [EB-05] Date de sortie Octobre 2026</article>
    `);
    expect(parsed.map((product) => [product.id, product.releaseDate]))
      .toEqual([["OP-17", "2026-08-28"]]);
  });
});

describe("OP Watch V1 - qualification produit", () => {
  it("distingue booster, display, case, double pack et starter", () => {
    expect(detectProductFormat("Booster OP17 FR à l'unité")).toBe("booster");
    expect(detectProductFormat("Display OP17 - boîte de 24 boosters")).toBe("display");
    expect(detectProductFormat("Case scellée 12 displays OP17")).toBe("case");
    expect(detectProductFormat("Double Pack Set DP-10 FR")).toBe("double_pack");
    expect(detectProductFormat("Starter Deck ST-31 Français")).toBe("starter");
  });

  it("rejette explicitement EN et JP même si FR apparaît ailleurs", () => {
    expect(detectFrenchListing("Display OP17 Japanese JP - livraison France").language).toBe("non_fr");
    expect(detectFrenchListing("Display OP17 English ENG FR shipping").language).toBe("non_fr");
  });

  it("ne traite pas la préposition 'en français' comme l'abréviation anglaise EN", () => {
    expect(detectFrenchListing("Display OP17 en français")).toEqual({
      language: "fr_confirmed",
      confidence: 100
    });
    expect(detectFrenchListing("Display OP17 EN").language).toBe("non_fr");
  });

  it("n'alerte pas quand la langue française n'est pas confirmée", () => {
    const result = qualifyListing({
      store: "fantasy-sphere",
      title: "Boîte de 24 Boosters - EB05 - One Piece CG",
      url: "https://www.fantasysphere.net/produit/eb05",
      pageText: "Ajouter au panier 119,90 €",
      activeProducts: [EB05]
    });
    expect(result.actionable).toBe(false);
    expect(result.reasons).toContain("Français non confirmé.");
  });

  it("valide une display FR clairement identifiée", () => {
    const result = qualifyListing({
      store: "fantasy-sphere",
      title: "Boîte de 24 Boosters - Extra Booster - EB05 - One Piece CG - FR",
      url: "https://www.fantasysphere.net/produit/eb05",
      pageText: "Version française - Précommande - Ajouter au panier",
      activeProducts: [EB05]
    });
    expect(result.actionable).toBe(true);
    expect(result.productId).toBe("EB-05");
    expect(result.format).toBe("display");
    expect(result.identityKey).toBe("fantasy-sphere|EB-05|display|fr");
  });

  it("rejette les accessoires même s'ils contiennent la référence", () => {
    const result = qualifyListing({
      store: "shop",
      title: "Sleeves OP17 FR",
      url: "https://shop.test/sleeves-op17-fr",
      activeProducts: [OP17]
    });
    expect(result.actionable).toBe(false);
    expect(result.reasons).toContain("Accessoire/carte unitaire rejeté.");
  });

  it("garde la même identité si l'URL change", () => {
    expect(listingIdentity("Fantasy-Sphere", "EB-05", "display")).toBe("fantasy-sphere|EB-05|display|fr");
  });

  it("récupère og:image et résout les URLs relatives", () => {
    const html = `<html><head><meta property="og:image" content="/img/eb05-display.jpg"></head></html>`;
    expect(extractProductImage(html, "https://shop.test/product/eb05")).toBe("https://shop.test/img/eb05-display.jpg");
  });

  it("ne rend commercial qu'un format ciblé, FR confirmé et dans la fenêtre active", () => {
    const base = {
      store: "shop",
      storeName: "Shop",
      title: "Display OP-17 Français",
      url: "https://shop.test/op17",
      sourceUrl: "https://shop.test/op17",
      matchedReferences: ["OP17"],
      availability: "preorder" as const,
      language: "Français confirmé" as const,
      commercialEligible: true,
      excerpt: "Précommande"
    };
    expect(candidateForActiveProducts(base, [OP17])).toMatchObject({
      matchedReferences: ["OP-17"],
      format: "display"
    });
    expect(candidateForActiveProducts({ ...base, languageConfidence: 89 }, [OP17], ["Français confirmé"], 90)).toBeUndefined();
    expect(candidateForActiveProducts({ ...base, languageConfidence: 90 }, [OP17], ["Français confirmé"], 90)).toBeDefined();
    expect(candidateForActiveProducts({ ...base, language: "Anglais détecté" }, [OP17])).toBeUndefined();
    expect(candidateForActiveProducts({ ...base, availability: "unknown" }, [OP17])).toBeUndefined();
    expect(candidateForActiveProducts({ ...base, title: "Sleeves OP-17 Français" }, [OP17])).toBeUndefined();
    expect(candidateForActiveProducts(base, [EB05])).toBeUndefined();
  });

  it("rejette les dates calendaires impossibles au lieu de les normaliser", () => {
    expect(() => computeWatchWindow("2026-02-31")).toThrow(/date de sortie invalide/i);
  });

  it("construit des règles dynamiques strictement françaises", () => {
    const config = buildActiveWatchConfig([OP17, EB05]);
    expect(config.products.map((product) => product.id)).toEqual(["OP-17", "EB-05"]);
    expect(config.alerts.every((alert) => alert.languages.length === 1 && alert.languages[0] === "Français confirmé"))
      .toBe(true);
    expect(config.alerts.flatMap((alert) => alert.events)).toEqual(expect.arrayContaining([
      "preorder_opened",
      "back_in_stock",
      "became_unavailable",
      "price_drop",
      "price_increase"
    ]));
  });
});
