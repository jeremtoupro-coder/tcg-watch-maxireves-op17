import { describe, expect, it } from "vitest";
import { classifyStoreHealth } from "../src/cockpitApi";
import type { StoreRuntimeHealth } from "../src/durableMonitoring";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

function health(overrides: Partial<StoreRuntimeHealth> = {}): StoreRuntimeHealth {
  return {
    store: "maxireves",
    status: "completed",
    checkedAt: new Date(NOW - 60_000).toISOString(),
    completedAt: new Date(NOW - 59_000).toISOString(),
    durationMs: 20,
    merchantDurationMs: 0,
    candidates: 0,
    merchantSources: 0,
    successfulMerchantSources: 0,
    deferredFastWatch: false,
    discovery: false,
    ...overrides
  };
}

describe("vérité opérationnelle du cockpit", () => {
  it("ne peint pas en vert un simple réveil du Durable Object sans lecture marchande", () => {
    const state = classifyStoreHealth("active_fast_watch", health(), NOW);
    expect(state.level).toBe("red");
    expect(state.label).toMatch(/Aucun contrôle marchand/i);
  });

  it("distingue une Discovery réelle sans fiche promue au Fast Watch", () => {
    const at = new Date(NOW - 2 * 60_000).toISOString();
    const state = classifyStoreHealth("active_fast_watch", health({
      lastMerchantCheckAt: at,
      lastDiscoveryAt: at,
      merchantSources: 3,
      successfulMerchantSources: 3,
      deferredFastWatch: true,
      discovery: true
    }), NOW);
    expect(state.level).toBe("amber");
    expect(state.label).toBe("Discovery active");
  });

  it("n'affiche vert qu'après une lecture marchande Fast Watch récente", () => {
    const at = new Date(NOW - 90_000).toISOString();
    const state = classifyStoreHealth("active_fast_watch", health({
      lastMerchantCheckAt: at,
      lastFastWatchAt: at,
      merchantSources: 1,
      successfulMerchantSources: 1
    }), NOW);
    expect(state.level).toBe("green");
    expect(state.label).toBe("Fast Watch observé");
  });

  it("explique explicitement une revalidation de feed inchangé", () => {
    const at = new Date(NOW - 60_000).toISOString();
    const state = classifyStoreHealth("active_fast_watch", health({
      lastMerchantCheckAt: at,
      lastFastWatchAt: at,
      merchantSources: 1,
      successfulMerchantSources: 1,
      sourceChecks: [{
        source: "authorized-feed:joueclub",
        status: 304,
        cacheValidation: "etag",
        notModified: true,
        responseBytes: 0
      }]
    }), NOW);
    expect(state.level).toBe("green");
    expect(state.detail).toMatch(/revalidé sans changement.*304/i);
  });

  it("reste orange lorsqu'un gros feed sans validateur attend la Discovery", () => {
    const discoveryAt = new Date(NOW - 5 * 60_000).toISOString();
    const state = classifyStoreHealth("active_fast_watch", health({
      lastDiscoveryAt: discoveryAt,
      deferredFastWatch: true,
      sourceChecks: [{
        source: "authorized-feed:playin",
        cacheValidation: "none",
        deferred: true,
        responseBytes: 0
      }]
    }), NOW);
    expect(state.level).toBe("amber");
    expect(state.label).toBe("Discovery active");
    expect(state.detail).toMatch(/sans validateur.*Discovery/i);
  });

  it("reste rouge si le cycle global est ancien même avec une ancienne preuve Fast Watch", () => {
    const at = new Date(NOW - 10 * 60_000).toISOString();
    const state = classifyStoreHealth("active_fast_watch", health({
      checkedAt: at,
      lastMerchantCheckAt: at,
      lastFastWatchAt: at
    }), NOW);
    expect(state.level).toBe("red");
    expect(state.label).toBe("Cycle en retard");
  });
});
