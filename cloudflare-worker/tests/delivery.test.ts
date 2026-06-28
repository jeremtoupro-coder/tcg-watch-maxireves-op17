import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateCandidates } from "../src/engine";
import { MemoryStateStore, productStateKey } from "../src/state";
import type { ProductCandidate, ProductSnapshot } from "../src/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function candidate(): ProductCandidate {
  return {
    store: "oupi",
    storeName: "Oupi",
    title: "OP-17 Booster Box French",
    url: "https://example.test/op17-fr",
    sourceUrl: "https://example.test/category",
    matchedReferences: ["OP17"],
    availability: "available",
    language: "Français confirmé",
    priceText: "119,90 €",
    excerpt: "En stock"
  };
}

describe("anti-doublon persistant", () => {
  it("n'envoie qu'une fois la même transition logique", async () => {
    const currentCandidate = candidate();
    const previous: ProductSnapshot = {
      key: productStateKey(currentCandidate),
      store: currentCandidate.store,
      storeName: currentCandidate.storeName,
      title: currentCandidate.title,
      url: currentCandidate.url,
      matchedReferences: currentCandidate.matchedReferences,
      availability: "unavailable",
      language: currentCandidate.language,
      priceText: currentCandidate.priceText,
      priceCents: 11990,
      firstSeenAt: "2026-06-27T10:00:00.000Z",
      lastSeenAt: "2026-06-27T10:05:00.000Z"
    };

    const stateStore = new MemoryStateStore({
      writable: true,
      seed: [previous],
      seedMetadata: {
        "baseline:config-v1:oupi": "complete"
      }
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      AUDIT_MODE: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "live" as const,
      DISCORD_WEBHOOK_URL: "https://discord.example.test/webhook"
    };

    const first = await evaluateCandidates([currentCandidate], env, {
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-06-27T10:10:00.000Z",
      claimSettleMs: 0
    });

    expect(first.discordDispatch.sent).toBe(1);
    expect(first.deliveryDedupe.receiptsWritten).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await stateStore.put(previous.key, previous);

    const duplicate = await evaluateCandidates([currentCandidate], env, {
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-06-27T10:10:00.000Z",
      claimSettleMs: 0
    });

    expect(duplicate.alertMatches).toHaveLength(1);
    expect(duplicate.discordDispatch.sent).toBe(0);
    expect(duplicate.deliveryDedupe.suppressedByReceipt).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuse le mode live sans mémoire persistante en écriture", async () => {
    const currentCandidate = candidate();
    const previous: ProductSnapshot = {
      key: productStateKey(currentCandidate),
      store: currentCandidate.store,
      storeName: currentCandidate.storeName,
      title: currentCandidate.title,
      url: currentCandidate.url,
      matchedReferences: currentCandidate.matchedReferences,
      availability: "unavailable",
      language: currentCandidate.language,
      priceText: currentCandidate.priceText,
      priceCents: 11990,
      firstSeenAt: "2026-06-27T10:00:00.000Z",
      lastSeenAt: "2026-06-27T10:05:00.000Z"
    };

    const stateStore = new MemoryStateStore({
      writable: false,
      seed: [previous],
      seedMetadata: {
        "baseline:config-v1:oupi": "complete"
      }
    });

    const result = await evaluateCandidates([currentCandidate], {
      WRITE_STATE: "false",
      DISCORD_MODE: "live",
      DISCORD_WEBHOOK_URL: "https://discord.example.test/webhook"
    }, {
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-06-27T10:10:00.000Z",
      claimSettleMs: 0
    });

    expect(result.discordDispatch.sent).toBe(0);
    expect(result.discordDispatch.errors[0]).toMatch(/anti-doublon/);
  });
});
