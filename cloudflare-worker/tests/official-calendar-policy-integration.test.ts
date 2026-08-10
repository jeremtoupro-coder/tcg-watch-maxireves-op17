import { describe, expect, it, vi } from "vitest";
import { loadOfficialCalendar } from "../src/officialCalendar";

const FUTURE_PAGE = `
  <html><head><title>PRODUITS | ONE PIECE CARD GAME</title></head><body>
    <h1>PRODUITS ONE PIECE CARD GAME</h1>
    <article>BOOSTER [OP-19] Date de sortie 28 août 2027</article>
    <nav>1 / 1</nav>
  </body></html>
`;

describe("intégration calendrier officiel -> fenêtre de surveillance", () => {
  it("inclut immédiatement une référence officielle même plus de quatre mois avant sa sortie", async () => {
    const fetcher = vi.fn(async () => new Response(FUTURE_PAGE, { status: 200 })) as typeof fetch;
    const calendar = await loadOfficialCalendar({
      sourceUrl: "https://fr.onepiece-cardgame.com/products/",
      now: new Date("2027-02-28T12:00:00.000Z"),
      daysBefore: 120,
      daysAfter: 30,
      fetcher
    });

    expect(calendar.activeProducts.map((product) => product.id)).toEqual(["OP-19"]);
    expect(calendar.activeProducts[0].watchWindow).toMatchObject({
      activationPolicy: "official_calendar_presence",
      endsOn: "2027-09-28",
      active: true
    });
  });

  it("retire impérativement la référence le lendemain du mois calendaire post-sortie", async () => {
    const fetcher = vi.fn(async () => new Response(FUTURE_PAGE, { status: 200 })) as typeof fetch;
    const calendar = await loadOfficialCalendar({
      sourceUrl: "https://fr.onepiece-cardgame.com/products/",
      now: new Date("2027-09-29T00:00:00.000Z"),
      daysBefore: 120,
      daysAfter: 30,
      fetcher
    });

    expect(calendar.catalogProducts.map((product) => product.id)).toEqual(["OP-19"]);
    expect(calendar.activeProducts).toEqual([]);
  });
});
