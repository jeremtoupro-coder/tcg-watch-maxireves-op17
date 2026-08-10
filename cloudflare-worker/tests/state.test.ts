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
    matchedReferences: ["OP-17"],
    format: "display",
    identityKey: "oupi|OP-17|display|fr|displayop17",
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
    expect(second.stateWrites).toBe(0);
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

  it("conserve la même identité lorsque l'URL marchande change", async () => {
    const store = new MemoryStateStore();
    const first = await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });
    const moved = await processCandidates([
      candidate({ url: "https://oupi.eu/produit/nouvelle-url-op17.html" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:01:00.000Z",
      initialBaselineByStore: { oupi: false }
    });

    expect(moved.snapshots[0].key).toBe(first.snapshots[0].key);
    expect(moved.changes.map((change) => change.type)).toEqual(["details_changed"]);
    expect(moved.changes.every((change) => change.type !== "new_listing")).toBe(true);
  });
});
