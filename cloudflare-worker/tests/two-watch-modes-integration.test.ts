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

const categoryUrl = "https://www.espritjeu.com/cartes-et-jcc/one-piece-le-jeu-de-cartes.html";
const categoryPage2Url = `${categoryUrl}?numPage=2`;
const op09Url = "https://www.espritjeu.com/one-piece-display-op09-francais.html";
const op17Url = "https://www.espritjeu.com/one-piece-display-op17-francais.html";

function installEspritFixture(options: { op09Available: () => boolean; includeOp17?: boolean; calls?: string[] }): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    options.calls?.push(url);
    if (url === categoryUrl || url === categoryPage2Url) {
      return new Response(`
        <html><body><h1>One Piece Card Game</h1>
          <div><a href="${op09Url}">One Piece Display OP09 Français</a><span>${options.op09Available() ? "En stock" : "Rupture de stock"}</span></div>
          ${options.includeOp17 === false ? "" : `<div><a href="${op17Url}">One Piece Display OP17 Français</a><span>En stock</span></div>`}
        </body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === op09Url) {
      return new Response(`
        <html><body><h1>One Piece Display OP09 Français</h1>
          <p>149,90 €</p><p>${options.op09Available() ? "En stock" : "Rupture de stock"}</p>
        </body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === op17Url && options.includeOp17 !== false) {
      return new Response(`
        <html><body><h1>One Piece Display OP17 Français</h1>
          <p>179,90 €</p><p>En stock</p>
        </body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`URL inattendue: ${url}`);
  }));
}

function monitoringEnv() {
  return {
    MONITORING_ENABLED: "true",
    WRITE_STATE: "true",
    DISCORD_MODE: "dry-run" as const,
    ACTIVE_STORES: "esprit-jeu"
  };
}

describe("double circuit en cycle marchand réel", () => {
  it("baseline l'ancien catalogue puis remonte OP09 sans doubler OP17", async () => {
    let op09Available = false;
    const calls: string[] = [];
    installEspritFixture({ op09Available: () => op09Available, calls });

    const stateStore = new MemoryStateStore({ writable: true });
    const env = monitoringEnv();

    const baseline = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 11, 18, 0, 0)
    });

    expect(baseline.analysis?.newReleases.candidates).toBe(1);
    expect(baseline.analysis?.onePieceAll.scanned).toBe(true);
    expect(baseline.analysis?.onePieceAll.candidates).toBe(2);
    expect(baseline.allEvaluation?.alertMatches).toEqual([]);
    expect(calls).toContain(categoryUrl);
    expect(calls).toContain(categoryPage2Url);
    expect(calls).toContain(op17Url);
    expect(calls).not.toContain(op09Url);

    calls.length = 0;
    op09Available = true;
    const restock = await runMonitoringCycle(env, {
      officialProducts: [OP17],
      stateStore,
      scheduledTime: Date.UTC(2026, 7, 11, 18, 15, 0)
    });

    expect(calls).toContain(op09Url);
    expect(restock.allEvaluation?.alertMatches).toHaveLength(1);
    expect(restock.allEvaluation?.alertMatches[0].matchedProductIds).toEqual(["OP-09"]);
    expect(restock.allEvaluation?.alertMatches[0].change.type).toBe("back_in_stock");
    expect(restock.allEvaluation?.alertMatches.some((match) => match.matchedProductIds.includes("OP-17"))).toBe(false);
  });

  it("continue ONE PIECE ALL même lorsqu'aucune sortie Bandai n'est active", async () => {
    let op09Available = false;
    const calls: string[] = [];
    installEspritFixture({ op09Available: () => op09Available, includeOp17: false, calls });
    const stateStore = new MemoryStateStore({ writable: true });
    const env = monitoringEnv();

    const baseline = await runMonitoringCycle(env, {
      officialProducts: [],
      stateStore,
      scheduledTime: Date.UTC(2026, 10, 11, 18, 0, 0)
    });
    expect(baseline.status).toBe("completed");
    expect(baseline.analysis?.newReleases.scanned).toBe(false);
    expect(baseline.analysis?.onePieceAll.scanned).toBe(true);
    expect(baseline.allEvaluation?.alertMatches).toEqual([]);
    expect(calls).not.toContain(op09Url);

    calls.length = 0;
    op09Available = true;
    const restock = await runMonitoringCycle(env, {
      officialProducts: [],
      stateStore,
      scheduledTime: Date.UTC(2026, 10, 11, 18, 15, 0)
    });
    expect(calls).toContain(op09Url);
    expect(restock.allEvaluation?.alertMatches).toHaveLength(1);
    expect(restock.allEvaluation?.alertMatches[0].matchedProductIds).toEqual(["OP-09"]);
    expect(restock.allEvaluation?.alertMatches[0].change.type).toBe("back_in_stock");
  });
});
