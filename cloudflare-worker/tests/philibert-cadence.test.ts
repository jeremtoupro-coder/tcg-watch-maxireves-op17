import { afterEach, describe, expect, it, vi } from "vitest";
import { runMonitoringCycle } from "../src/monitor";
import { aliasesForProduct, type OfficialProduct } from "../src/opwatchV1";
import { MemoryStateStore } from "../src/state";

const OP17: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER OP-17",
  releaseDate: "2026-08-28",
  aliases: aliasesForProduct("OP-17")
};

const PRODUCT_URL = "https://www.philibertnet.com/fr/one-piece-le-jeu-de-cartes/179735-one-piece-le-jeu-de-cartes-op17-les-guerriers-les-plus-puissants-au-monde-boite-de-24-boosters-2100001380243.html";
const RSS_URL = "https://www.philibertnet.com/modules/feeder/rss.php?id_category=15860";

const RSS = `<?xml version="1.0"?><rss><channel><title>One Piece Philibert</title><item><title><![CDATA[One Piece Le Jeu de Cartes - OP17 - Boite de 24 Boosters - 144,95€]]></title><link><![CDATA[${PRODUCT_URL}]]></link></item></channel></rss>`;
const PRODUCT = `<!doctype html><html><head><title>One Piece OP17 Français</title></head><body><h1>One Piece OP17 Boite de 24 Boosters Français</h1><p>À venir : Aout</p><p>144,95 €</p><p>Vendu par Philibert</p></body></html>`;

afterEach(() => vi.unstubAllGlobals());

describe("cadence Philibert RSS / Fast Watch", () => {
  it("lit le RSS en Discovery puis uniquement la fiche active en Fast Watch", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === RSS_URL) return new Response(RSS, { status: 200, headers: { "content-type": "application/xml" } });
      if (url === PRODUCT_URL) return new Response(PRODUCT, { status: 200, headers: { "content-type": "text/html" } });
      throw new Error(`URL inattendue: ${url}`);
    }));

    const stateStore = new MemoryStateStore({ writable: true });
    const env = {
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run" as const,
      ACTIVE_STORES: "philibert"
    };

    const discovery = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 18, 15, 0)
    });

    expect(discovery.healthyStores).toEqual(["philibert"]);
    expect(calls).toEqual([RSS_URL, PRODUCT_URL]);
    expect(await stateStore.getMetadata("discovery:v1:philibert")).toContain("179735-");

    calls.length = 0;
    const fast = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 10, 18, 16, 0)
    });

    expect(fast.healthyStores).toEqual(["philibert"]);
    expect(fast.deferredFastWatchStores).toEqual([]);
    expect(calls).toEqual([PRODUCT_URL]);
    expect(calls).not.toContain(RSS_URL);
  });
});
