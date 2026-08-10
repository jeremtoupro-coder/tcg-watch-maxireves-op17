import { afterEach, describe, expect, it, vi } from "vitest";
import { runMonitoringCycle } from "../src/monitor";
import { aliasesForProduct, type OfficialProduct } from "../src/opwatchV1";
import { MemoryStateStore } from "../src/state";

afterEach(() => vi.unstubAllGlobals());

const OP17: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER OP-17",
  releaseDate: "2026-08-28",
  aliases: aliasesForProduct("OP-17")
};

function amazonSearchHtml(): string {
  return `
    <html><head><title>One Piece Card Game français</title></head><body>
      <h1>One Piece Card Game français</h1>
      <a href="/dp/B0ABCDEF12">Display OP-17 Français</a>
    </body></html>`;
}

function amazonProductHtml(seller: string): string {
  return `
    <html><head><title>Display OP-17 Français</title></head><body>
      <h1>Display OP-17 Français</h1>
      <p>One Piece Card Game — Display 24 boosters — Français — En stock — 119,90 €</p>
      <p>Vendu par ${seller}</p>
    </body></html>`;
}

describe("garde-fous Fast Watch", () => {
  it("sépare forceStore de forceDiscovery", async () => {
    const fetchMock = vi.fn(async () => new Response(
      "<html><head><title>One Piece Card Game</title></head><body><h1>One Piece Card Game</h1></body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const stateStore = new MemoryStateStore({
      writable: true,
      seedMetadata: { "monitor:last-discovery": "2026-08-10T09:15:00.000Z" }
    });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "maxireves"
    };

    const storeOnly = await runMonitoringCycle(env, {
      forceStore: "maxireves",
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 16, 0)
    });
    expect(storeOnly.deferredFastWatchStores).toEqual(["maxireves"]);
    expect(fetchMock).not.toHaveBeenCalled();

    const forcedDiscovery = await runMonitoringCycle(env, {
      forceStore: "maxireves",
      forceDiscovery: true,
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 16, 0)
    });
    expect(forcedDiscovery.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("ne promeut jamais Amazon en Fast Watch sans vendeur Amazon confirmé", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(url.includes("/dp/") ? amazonProductHtml("Boutique Partenaire") : amazonSearchHtml(), {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));

    const stateStore = new MemoryStateStore({ writable: true });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "amazon-fr"
    };

    const discovery = await runMonitoringCycle(env, {
      forceStore: "amazon-fr",
      forceDiscovery: true,
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 15, 0)
    });
    expect(discovery.status).toBe("completed");
    expect(await stateStore.getMetadata("discovery:v1:amazon-fr")).toContain('"entries":[]');

    calls.length = 0;
    const fast = await runMonitoringCycle(env, {
      forceStore: "amazon-fr",
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 16, 0)
    });
    expect(fast.deferredFastWatchStores).toEqual(["amazon-fr"]);
    expect(calls).toEqual([]);
  });

  it("autorise une fiche Amazon qualifiée après confirmation explicite du vendeur", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(url.includes("/dp/") ? amazonProductHtml("Amazon.fr") : amazonSearchHtml(), {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));

    const stateStore = new MemoryStateStore({ writable: true });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "amazon-fr"
    };

    await runMonitoringCycle(env, {
      forceStore: "amazon-fr",
      forceDiscovery: true,
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 15, 0)
    });
    expect(await stateStore.getMetadata("discovery:v1:amazon-fr")).toContain("B0ABCDEF12");

    calls.length = 0;
    const fast = await runMonitoringCycle(env, {
      forceStore: "amazon-fr",
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 9, 16, 0)
    });
    expect(fast.deferredFastWatchStores).toEqual([]);
    expect(calls).toEqual(["https://www.amazon.fr/dp/B0ABCDEF12"]);
  });
});
