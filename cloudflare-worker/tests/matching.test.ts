import { describe, expect, it } from "vitest";
import {
  decodeHtml,
  detectAvailability,
  detectLanguage,
  extractPrice,
  matchReferences
} from "../src/matching";

describe("matchReferences", () => {
  it.each([
    ["Display OP-17 FR", ["OP-17"]],
    ["Booster OP 18", ["OP-18"]],
    ["Starter Deck ST31", ["ST-31"]],
    ["Extra Booster PRB 03", ["PRB-03"]]
  ])("reconnaît %s", (input, expected) => {
    expect(matchReferences(input)).toEqual(expected);
  });
});

describe("decodeHtml", () => {
  it("décode les entités numériques hexadécimales", () => {
    expect(decodeHtml("&#x41;&#65;")).toBe("AA");
  });

  it("décode l'entité euro nommée", () => {
    expect(decodeHtml("249,90 &euro;")).toBe("249,90 €");
  });
});

describe("detectLanguage", () => {
  it("confirme le français", () => {
    expect(detectLanguage("Display OP17 FR - version française")).toBe("Français confirmé");
  });

  it("reconnaît French dans un titre anglais", () => {
    expect(detectLanguage("OP-17 Booster Box (French)")).toBe("Français confirmé");
  });

  it("détecte l'anglais", () => {
    expect(detectLanguage("Booster OP17 English version")).toBe("Anglais détecté");
    expect(detectLanguage("Booster OP17 EN")).toBe("Anglais détecté");
    expect(detectLanguage("Booster OP17 eng")).toBe("Anglais détecté");
  });

  it("ne confond pas la préposition française en avec l'abréviation EN", () => {
    expect(detectLanguage("Boite de 24 boosters en français")).toBe("Français confirmé");
    expect(detectLanguage("Double Pack OP16 (En Français)")).toBe("Français confirmé");
  });

  it("donne priorité à une version anglaise explicite même sur le storefront français", () => {
    expect(detectLanguage(
      "https://www.pixelheart.eu/fr/produit/one-piece-op-18-version-anglaise/ One Piece OP-18 Version Anglaise"
    )).toBe("Anglais détecté");
  });

  it("conserve une version française explicite", () => {
    expect(detectLanguage(
      "https://www.pixelheart.eu/fr/produit/one-piece-op-18-version-francaise/ One Piece OP-18 Version Française"
    )).toBe("Français confirmé");
  });

  it("ne rejette pas une langue absente", () => {
    expect(detectLanguage("Booster sans langue indiquée")).toBe("Langue non précisée");
  });
});

describe("detectAvailability", () => {
  it("donne priorité à la rupture", () => {
    expect(detectAvailability("Ajouter au panier - rupture de stock")).toBe("unavailable");
  });

  it("détecte une précommande", () => {
    expect(detectAvailability("Précommande ouverte")).toBe("preorder");
  });

  it("détecte un produit commandable", () => {
    expect(detectAvailability("3 en stock - Ajouter au panier")).toBe("available");
  });
});

describe("extractPrice", () => {
  it("extrait un prix français", () => {
    expect(extractPrice("Prix : 149,90 € TTC")).toBe("149,90 €");
  });

  it("extrait un prix HTML encodé", () => {
    expect(extractPrice("Display OP17 249,90 &euro;")).toBe("249,90 €");
  });

  it("extrait un prix avec euro devant", () => {
    expect(extractPrice("€7.42 Price")).toBe("€7.42");
  });

  it("conserve un séparateur de milliers international", () => {
    expect(extractPrice("€1,437.12 Price")).toBe("€1,437.12");
  });

  it("conserve un séparateur de milliers français", () => {
    expect(extractPrice("Prix 1 437,12 € TTC")).toBe("1 437,12 €");
  });
});
