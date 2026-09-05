import { describe, expect, it } from "vitest";
import {
  PROTECTED_STORE_SCOUT_INTERVAL_HOURS,
  PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP,
  buildProtectedStoreScoutQuery,
  isProtectedStoreScoutTick,
  qualifyProtectedSearchResult
} from "../src/protectedStoreScout";
import type { OfficialProduct } from "../src/opwatchV1";

function product(id: string): OfficialProduct {
  return {
    id,
    family: id.startsWith("EB") ? "EB" : "OP",
    label: id,
    releaseDate: "2026-11-01",
    aliases: [id, id.replace("-", ""), id.replace("-", " ")]
  };
}

describe("Protected Store Scout", () => {
  const products = [product("EB-05"), product("OP-18")];

  it("tourne huit fois par jour, à :11, sans modifier le Web Scout horaire", () => {
    expect(PROTECTED_STORE_SCOUT_INTERVAL_HOURS).toBe(3);
    expect(isProtectedStoreScoutTick(Date.parse("2026-09-05T00:11:00Z"))).toBe(true);
    expect(isProtectedStoreScoutTick(Date.parse("2026-09-05T03:11:00Z"))).toBe(true);
    expect(isProtectedStoreScoutTick(Date.parse("2026-09-05T01:11:00Z"))).toBe(false);
    expect(isProtectedStoreScoutTick(Date.parse("2026-09-05T03:12:00Z"))).toBe(false);
  });

  it("borne son budget à 248 recherches mensuelles", () => {
    expect(PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP).toBe(248);
    expect(744 + PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP).toBe(992);
  });

  it("construit une seule requête Brave ciblant les six domaines protégés", () => {
    const query = buildProtectedStoreScoutQuery(products);
    expect(query).toContain('"EB-05"');
    expect(query).toContain('"OP-18"');
    for (const domain of ["play-in.com", "cultura.com", "micromania.fr", "fnac.com", "carrefour.fr", "king-jouet.com"]) {
      expect(query).toContain(`site:${domain}`);
    }
    expect(query).toContain("lang:fr");
    expect(query.length).toBeLessThanOrEqual(400);
  });

  it("qualifie une fiche Fnac OP18 depuis les snippets d'index sans requête marchand", () => {
    const finding = qualifyProtectedSearchResult({
      title: "One Piece : OP18 Booster Blister (24) FR - Fnac",
      url: "https://www.fnac.com/One-Piece-OP18-Booster-Blister-24-FR/a23540948/w-4",
      description: "One Piece OP18 Booster Blister FR - précommande - 4,99 €"
    }, products);

    expect(finding).toMatchObject({
      store: "fnac",
      storeName: "Fnac",
      matchedProductIds: ["OP-18"]
    });
  });

  it("qualifie une fiche Playin uniquement si l'URL est une vraie fiche produit", () => {
    expect(qualifyProtectedSearchResult({
      title: "Display OP-18 One Piece FR",
      url: "https://www.play-in.com/fr/produit/999999/display-op-18-one-piece-fr",
      description: "Précommande One Piece OP18 français - 119,90 €"
    }, products)?.store).toBe("playin");

    expect(qualifyProtectedSearchResult({
      title: "Catalogue One Piece OP18 FR",
      url: "https://www.play-in.com/fr/gamme/24/one-piece/catalogue",
      description: "Précommande One Piece OP18 français"
    }, products)).toBeUndefined();
  });

  it("rejette une fiche sans preuve FR ou sans signal commercial", () => {
    expect(qualifyProtectedSearchResult({
      title: "One Piece OP18 Booster EN",
      url: "https://www.fnac.com/One-Piece-OP18-Booster-EN/a23540948/w-4",
      description: "One Piece OP18 English version in stock"
    }, products)).toBeUndefined();

    expect(qualifyProtectedSearchResult({
      title: "One Piece OP18 FR",
      url: "https://www.fnac.com/One-Piece-OP18-FR/a23540948/w-4",
      description: "Article de présentation en français"
    }, products)).toBeUndefined();
  });
});
