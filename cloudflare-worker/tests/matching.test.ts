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
    ["Display OP-17 FR", ["OP17"]],
    ["Booster OP 18", ["OP18"]],
    ["Illustration Box Vol.7", ["IB-07"]],
    ["Illustration Box Volume 8", ["IB-08"]],
    ["IB07 et IB-08", ["IB-07", "IB-08"]]
  ])("reconnaît %s", (input, expected) => {
    expect(matchReferences(input)).toEqual(expected);
  });
});

describe("decodeHtml", () => {
  it("décode les entités numériques hexadécimales", () => {
    expect(decodeHtml("&#x41;&#65;")).toBe("AA");
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
  });

  it("ne rejette pas une langue absente", () => {
    expect(detectLanguage("Illustration Box Vol.7")).toBe("Langue non précisée");
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
