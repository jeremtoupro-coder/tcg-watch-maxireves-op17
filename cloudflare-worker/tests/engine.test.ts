import { describe, expect, it } from "vitest";
import { evaluateCandidates } from "../src/engine";
import { MemoryStateStore } from "../src/state";
import type { ProductCandidate } from "../src/types";

function candidate(url: string, availability: ProductCandidate["availability"]): ProductCandidate {
  return {
    store: "oupi",
    storeName: "Oupi",
    title: "Display OP-17 FR",
    url,
    sourceUrl: "https://oupi.eu/en/413-pre-order-one-piece",
    matchedReferences: ["OP17"],
    availability,
    language: "Français confirmé",
    priceText: "119,76 €",
    excerpt: "Display OP-17 FR"
  };
}

describe("marqueur de base initiale", () => {
  it("silence la base puis alerte une nouvelle fiche future", async () => {
    const stateStore = new MemoryStateStore();
    const env = {
      AUDIT_MODE: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const
    };

    const baseline = await evaluateCandidates([
      candidate("https://example.test/op17-baseline", "unavailable")
    ], env, {
      stateStore,
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(baseline.state.baselineCompleteBefore).toBe(false);
    expect(baseline.state.baselineMarkedComplete).toBe(true);
    expect(baseline.changes[0].initial).toBe(true);
    expect(baseline.alertMatches).toEqual([]);

    const futureListing = await evaluateCandidates([
      candidate("https://example.test/op17-future", "available")
    ], env, {
      stateStore,
      now: "2026-06-28T10:00:00.000Z"
    });

    expect(futureListing.state.baselineCompleteBefore).toBe(true);
    expect(futureListing.changes[0].type).toBe("new_listing");
    expect(futureListing.changes[0].initial).toBe(false);
    expect(futureListing.alertMatches).toHaveLength(1);
    expect(futureListing.discordDispatch.sent).toBe(0);
    expect(futureListing.discordDispatch.attempted).toBe(1);
  });
});
