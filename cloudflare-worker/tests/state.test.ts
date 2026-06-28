import { describe, expect, it } from "vitest";
import { MemoryStateStore, processCandidates } from "../src/state";
import type { ProductCandidate } from "../src/types";

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    store: "oupi",
    storeName: "Oupi",
    title: "Display OP-17 FR",
    url: "https://oupi.eu/produit/op-17-fr.html",
    sourceUrl: "https://oupi.eu/en/413-pre-order-one-piece",
    matchedReferences: ["OP17"],
    availability: "unavailable",
    language: "Français confirmé",
    priceText: "119,76 €",
    excerpt: "Display OP-17 FR",
    ...overrides
  };
}

describe("état produit et anti-doublon", () => {
  it("crée une base silencieuse puis ne répète pas le même événement", async () => {
    const store = new MemoryStateStore();
    const first = await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(first.changes.map((change) => change.type)).toEqual(["new_listing"]);
    expect(first.changes[0].initial).toBe(true);

    const second = await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:01:00.000Z"
    });

    expect(second.changes).toEqual([]);
  });

  it("détecte un retour en stock", async () => {
    const store = new MemoryStateStore();
    await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    const result = await processCandidates([
      candidate({ availability: "available" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:02:00.000Z"
    });

    expect(result.changes.map((change) => change.type)).toContain("back_in_stock");
  });

  it("détecte une baisse de prix", async () => {
    const store = new MemoryStateStore();
    await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    const result = await processCandidates([
      candidate({ priceText: "99,90 €" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:03:00.000Z"
    });

    expect(result.changes.map((change) => change.type)).toContain("price_drop");
    expect(result.snapshots[0].priceCents).toBe(9990);
  });

  it("fusionne deux occurrences de la même URL", async () => {
    const store = new MemoryStateStore();
    const result = await processCandidates([candidate(), candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(result.uniqueCandidates).toBe(1);
    expect(result.stateWrites).toBe(1);
  });
});
