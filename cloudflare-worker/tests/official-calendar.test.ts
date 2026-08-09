import { describe, expect, it, vi } from "vitest";
import {
  loadOfficialCalendar,
  parseOfficialCatalogPageCount,
  validateOfficialCatalogPage
} from "../src/officialCalendar";
import { parseOfficialCatalog } from "../src/opwatchV1";
import { MemoryStateStore } from "../src/state";

const PAGE_1 = `
  <html><head><title>PRODUITS | ONE PIECE CARD GAME</title></head><body>
    <h1>PRODUITS ONE PIECE CARD GAME</h1>
    <article>BOOSTER -LES GUERRIERS LES PLUS PUISSANTS- [OP-17]
      Date de sortie 28 août 2026</article>
    <article>EXTRA BOOSTER [EB-05] Date de sortie Octobre 2026</article>
    <nav>1 / 2</nav>
  </body></html>
`;

const PAGE_2 = `
  <html><head><title>PRODUITS | ONE PIECE CARD GAME</title></head><body>
    <h1>PRODUITS ONE PIECE CARD GAME</h1>
    <article>DECK POUR DÉBUTANT [ST-31] Date de sortie 31 juillet 2026</article>
    <nav>2 / 2</nav>
  </body></html>
`;

describe("calendrier officiel français", () => {
  it("parse les dates françaises exactes et ignore un mois sans jour", () => {
    expect(parseOfficialCatalog(PAGE_1).map((product) => [product.id, product.releaseDate]))
      .toEqual([["OP-17", "2026-08-28"]]);
  });

  it("détermine le nombre de pages sans dépasser la limite de sûreté", () => {
    expect(parseOfficialCatalogPageCount(PAGE_1)).toBe(2);
    expect(() => parseOfficialCatalogPageCount(PAGE_1.replace("1 / 2", "1 / 99")))
      .toThrow(/pagination officielle invalide/i);
  });

  it("charge toutes les pages officielles et calcule J-120/J+30", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(url.searchParams.get("page") === "2" ? PAGE_2 : PAGE_1, { status: 200 });
    }) as typeof fetch;

    const calendar = await loadOfficialCalendar({
      sourceUrl: "https://fr.onepiece-cardgame.com/products/",
      now: new Date("2026-08-09T12:00:00.000Z"),
      daysBefore: 120,
      daysAfter: 30,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calendar.sourcePages).toBe(2);
    expect(calendar.catalogProducts.map((product) => product.id)).toEqual(["ST-31", "OP-17"]);
    expect(calendar.activeProducts.map((product) => product.id)).toEqual(["ST-31", "OP-17"]);
    expect(calendar.activeProducts.every((product) => product.watchWindow.active)).toBe(true);
  });

  it("réutilise le cache 15 minutes sans requête ni nouvelle écriture", async () => {
    const store = new MemoryStateStore({ writable: true });
    const fetcher = vi.fn(async () => new Response(PAGE_1.replace("1 / 2", "1 / 1"), { status: 200 })) as typeof fetch;
    const first = await loadOfficialCalendar({
      sourceUrl: "https://fr.onepiece-cardgame.com/products/",
      now: new Date("2026-08-09T12:00:00.000Z"),
      daysBefore: 120,
      daysAfter: 30,
      stateStore: store,
      fetcher
    });
    const second = await loadOfficialCalendar({
      sourceUrl: "https://fr.onepiece-cardgame.com/products/",
      now: new Date("2026-08-09T12:05:00.000Z"),
      daysBefore: 120,
      daysAfter: 30,
      stateStore: store,
      fetcher
    });

    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejette une page de challenge HTTP 200", () => {
    expect(() => validateOfficialCatalogPage(`
      <html><head><title>Just a moment...</title></head><body>
        ONE PIECE CARD GAME PRODUITS OP-17
      </body></html>
    `)).toThrow(/challenge/i);
  });

  it("refuse toute source non officielle", async () => {
    await expect(loadOfficialCalendar({
      sourceUrl: "https://example.test/products/",
      daysBefore: 120,
      daysAfter: 30
    })).rejects.toThrow(/site officiel français/i);
  });
});
