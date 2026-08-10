import { describe, expect, it } from "vitest";
import { validateOfficialCatalogPage } from "../src/officialCalendar";
import { parseOfficialCatalogWithMonthFallback } from "../src/officialMonthFallback";

describe("OP Watch - future official Bandai families", () => {
  it("accepts a future bracketed family with an exact official release date", () => {
    const products = parseOfficialCatalogWithMonthFallback(`
      <article>
        <h3>NEW PRODUCT [XR-01]</h3>
        <p>Date de sortie 17 octobre 2026</p>
      </article>
    `);

    expect(products).toEqual([
      expect.objectContaining({
        id: "XR-01",
        family: "OTHER",
        releaseDate: "2026-10-17",
        releaseDatePrecision: "exact",
        aliases: ["XR-01", "XR01", "XR 01"]
      })
    ]);
  });

  it("uses the first day of the month for a future family announced month-only", () => {
    const products = parseOfficialCatalogWithMonthFallback(`
      <article>
        <h3>NEW PRODUCT [XR-02]</h3>
        <p>Release Date November 2026</p>
      </article>
    `);

    expect(products).toEqual([
      expect.objectContaining({
        id: "XR-02",
        family: "OTHER",
        releaseDate: "2026-11-01",
        releaseDatePrecision: "month_assumed_first"
      })
    ]);
  });

  it("does not broaden unknown-family parsing to an unbracketed arbitrary code", () => {
    const products = parseOfficialCatalogWithMonthFallback(`
      <article>
        <h3>NEW PRODUCT XR-03</h3>
        <p>Date de sortie 17 octobre 2026</p>
      </article>
    `);

    expect(products).toEqual([]);
  });

  it("lets the validated official catalog contain only a constrained future family", () => {
    expect(() => validateOfficialCatalogPage(`
      <html><head><title>ONE PIECE CARD GAME</title></head>
      <body><h1>PRODUITS</h1><article>[XR-01] Date de sortie 17 octobre 2026</article></body></html>
    `)).not.toThrow();
  });

  it("still fails closed on contradictory exact dates for the same future reference", () => {
    expect(() => parseOfficialCatalogWithMonthFallback(`
      <article>[XR-01] Date de sortie 17 octobre 2026</article>
      <article>[XR-01] Date de sortie 24 octobre 2026</article>
    `)).toThrow(/Dates officielles contradictoires pour XR-01/i);
  });
});
