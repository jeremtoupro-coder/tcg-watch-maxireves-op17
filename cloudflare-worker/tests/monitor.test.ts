import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLOUDFLARE_STORES } from "../src/connectors";
import { isDiscoveryTick, parseActiveStores, runMonitoringCycle } from "../src/monitor";
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

describe("surveillance planifiée", () => {
  it("utilise les vingt-quatre boutiques OP Watch par défaut", () => {
    expect(parseActiveStores()).toEqual(DEFAULT_CLOUDFLARE_STORES);
    expect(parseActiveStores()).toHaveLength(24);
  });

  it("ignore les boutiques inconnues et supprime les doublons", () => {
    expect(parseActiveStores("oupi,inconnue,oupi,maxireves")).toEqual([
      "oupi",
      "maxireves"
    ]);
  });

  it("déclenche les sources discovery-only toutes les 15 minutes", () => {
    expect(isDiscoveryTick(Date.UTC(2026, 7, 9, 18, 0, 0))).toBe(true);
    expect(isDiscoveryTick(Date.UTC(2026, 7, 9, 18, 15, 0))).toBe(true);
    expect(isDiscoveryTick(Date.UTC(2026, 7, 9, 18, 14, 0))).toBe(false);
    expect(isDiscoveryTick()).toBe(false);
  });

  it("ne fait aucune requête lorsque la surveillance est désactivée", async () => {
    const result = await runMonitoringCycle({
      MONITORING_ENABLED: "false",
      WRITE_STATE: "false",
      DISCORD_MODE: "dry-run"
    });

    expect(result.status).toBe("disabled");
  });

  it("refuse une surveillance active sans KV", async () => {
    await expect(runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    })).rejects.toThrow(/TCG_STATE/);
  });

  it("refuse une surveillance active sans écriture persistante", async () => {
    await expect(runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "false",
      DISCORD_MODE: "dry-run",
      TCG_STATE: {} as KVNamespace
    })).rejects.toThrow(/WRITE_STATE/);
  });

  it("n'interroge jamais l'origine protégée même lors d'un forceStore sans feed", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("L'origine Playin ne devait pas être appelée");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    }, {
      forceStore: "playin",
      officialProducts: [OP17],
      stateStore: new MemoryStateStore({ writable: true }),
      scheduledTime: Date.UTC(2026, 7, 9, 18, 0, 0)
    });

    expect(result.status).toBe("completed");
    expect(result.pendingAuthorizedFeedStores).toEqual(["playin"]);
    expect(result.audits).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sépare la découverte des fiches du Fast Watch", async () => {
    const categoryHtml = `
      <html><head><title>One Piece TCG</title></head><body>
        <h1>One Piece Card Game</h1>
        <a href="https://maxireves.fr/produit/display-op17-fr/">Display OP-17 Français</a>
      </body></html>`;
    const productHtml = `
      <html><head><title>Display OP-17 Français</title></head><body>
        <h1>Display OP-17 Français</h1><p>One Piece Card Game — En stock — 119,90 €</p>
      </body></html>`;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(url.includes("/produit/") ? productHtml : categoryHtml, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));
    const stateStore = new MemoryStateStore({ writable: true });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "maxireves"
    };

    const discovery = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 9, 18, 1, 0)
    });
    expect(discovery.stores).toEqual(["maxireves"]);
    expect(calls.some((url) => url.includes("one-piece-tcg"))).toBe(true);
    expect(await stateStore.getMetadata("discovery:v1:maxireves")).toContain("display-op17-fr");

    calls.length = 0;
    const fast = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 9, 18, 2, 0)
    });
    expect(fast.deferredFastWatchStores).toEqual([]);
    expect(calls).toEqual(["https://maxireves.fr/produit/display-op17-fr/"]);
  });

  it("retire du Fast Watch une URL devenue absente après une découverte saine", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("<html><body><h1>Catalogue One Piece sans produit actif</h1></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));
    const stateStore = new MemoryStateStore({
      writable: true,
      seedMetadata: {
        "monitor:last-discovery": "2026-08-09T18:00:00.000Z",
        "discovery:v1:maxireves": JSON.stringify({
          discoveredAt: "2026-08-09T18:00:00.000Z",
          entries: [{
            url: "https://maxireves.fr/produit/display-op17-fr/",
            references: ["OP-17"]
          }]
        })
      }
    });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "maxireves"
    };

    await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 9, 18, 16, 0)
    });
    expect(await stateStore.getMetadata("discovery:v1:maxireves")).toContain('"entries":[]');

    calls.length = 0;
    const fast = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 9, 18, 17, 0)
    });
    expect(fast.deferredFastWatchStores).toEqual(["maxireves"]);
    expect(calls).toEqual([]);
  });

  it("répare les anciennes variantes Amazon du cache Fast Watch sans requêtes en double", async () => {
    const canonical = "https://www.amazon.fr/dp/B0ABCDEF12";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(`
        <html><head><title>One Piece Card Game</title></head><body>
          <h1>Display OP-17 Français</h1>
          <p>En stock - 119,90 €</p><p>Vendu par Amazon.fr</p>
        </body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));
    const stateStore = new MemoryStateStore({
      writable: true,
      seedMetadata: {
        "monitor:last-discovery": "2026-08-09T18:15:00.000Z",
        "discovery:v1:amazon-fr": JSON.stringify({
          discoveredAt: "2026-08-09T18:15:00.000Z",
          entries: [
            { url: `${canonical}?tag=tracking-21&ref_=sr_1_1`, references: ["OP-17"] },
            { url: `${canonical}#customerReviews`, references: ["OP-17"] },
            { url: "https://www.amazon.fr/gp/product/B0ABCDEF12/ref=s9_acsd_hps_bw_c2_x_1_w", references: ["OP-17"] }
          ]
        })
      }
    });

    const result = await runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run",
      ACTIVE_STORES: "amazon-fr"
    }, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 9, 18, 17, 0)
    });

    expect(calls).toEqual([canonical]);
    expect(result.audits?.[0].sources).toHaveLength(1);
    expect(result.audits?.[0].candidates).toHaveLength(1);
    expect(result.deferredFastWatchStores).toEqual([]);
  });
});
