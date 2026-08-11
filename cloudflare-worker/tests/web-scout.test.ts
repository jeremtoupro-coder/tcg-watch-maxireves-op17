import { describe, expect, it } from "vitest";
import {
  WEB_SCOUT_MIN_DOMAIN_AGE_DAYS,
  buildWebScoutQuery,
  extractLegalEvidence,
  hasCommercialSignal,
  hasFrenchSignal,
  isWebScoutTick,
  matchedProductIds,
  registeredDomainFromUrl,
  registrationDateFromRdap,
  selectScoutProducts
} from "../src/webScout";
import type { OfficialProduct } from "../src/opwatchV1";

function product(id: string, releaseDate: string): OfficialProduct {
  return {
    id,
    family: id.startsWith("EB") ? "EB" : "OP",
    label: id,
    releaseDate,
    aliases: [id, id.replace("-", ""), id.replace("-", " ")]
  };
}

describe("Web Scout", () => {
  it("runs once per hour at minute 07", () => {
    expect(isWebScoutTick(Date.parse("2026-08-11T19:07:00Z"))).toBe(true);
    expect(isWebScoutTick(Date.parse("2026-08-11T19:06:00Z"))).toBe(false);
    expect(isWebScoutTick(Date.parse("2026-08-11T19:37:00Z"))).toBe(false);
  });

  it("builds one compact Brave query for active refs", () => {
    const query = buildWebScoutQuery([
      product("EB-05", "2026-10-01"),
      product("OP-18", "2026-11-01")
    ]);
    expect(query).toContain('"EB-05"');
    expect(query).toContain('"OP-18"');
    expect(query).toContain("précommande");
    expect(query.length).toBeLessThanOrEqual(400);
  });

  it("rotates groups of at most six products", () => {
    const products = Array.from({ length: 13 }, (_, index) =>
      product(`OP-${String(index + 10).padStart(2, "0")}`, `2026-${String((index % 6) + 7).padStart(2, "0")}-01`)
    );
    const selected = selectScoutProducts(products, Date.parse("2026-08-11T19:07:00Z"));
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it("matches EB-05 and OP-18 aliases", () => {
    const products = [product("EB-05", "2026-10-01"), product("OP-18", "2026-11-01")];
    expect(matchedProductIds("Précommande One Piece EB05 FR", products)).toEqual(["EB-05"]);
    expect(matchedProductIds("Display OP 18 français", products)).toEqual(["OP-18"]);
  });

  it("requires useful commerce signals and rejects explicit foreign-only language", () => {
    expect(hasCommercialSignal("Précommande ouverte - 119,90 €")).toBe(true);
    expect(hasCommercialSignal("Article de blog One Piece")).toBe(false);
    expect(hasFrenchSignal("OP-18 FR - français")).toBe(true);
    expect(hasFrenchSignal("OP-18 Japanese version JP")).toBe(false);
  });

  it("recognizes French legal identifiers and address evidence", () => {
    const evidence = extractLegalEvidence(
      "Mentions légales — SIRET : 123 456 789 00012 — 12 rue des Cartes, 75011 Paris, France"
    );
    expect(evidence.legalIdentifier).toMatch(/SIRET/i);
    expect(evidence.addressEvidence).toBe(true);
    expect(WEB_SCOUT_MIN_DOMAIN_AGE_DAYS).toBe(180);
  });

  it("extracts RDAP registration dates", () => {
    expect(registrationDateFromRdap({
      events: [
        { eventAction: "last changed", eventDate: "2026-01-01T00:00:00Z" },
        { eventAction: "registration", eventDate: "2020-06-15T12:00:00Z" }
      ]
    })).toBe("2020-06-15T12:00:00Z");
  });

  it("normalizes common registered domains and refuses non-HTTPS", () => {
    expect(registeredDomainFromUrl("https://shop.example.fr/item")).toBe("example.fr");
    expect(registeredDomainFromUrl("https://shop.example.co.uk/item")).toBe("example.co.uk");
    expect(registeredDomainFromUrl("http://example.fr/item")).toBeUndefined();
  });
});
