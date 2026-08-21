import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

const safeEnv: Env = {
  AUDIT_MODE: "true",
  ALLOW_PUBLIC_AUDIT: "false",
  MONITORING_ENABLED: "false",
  WRITE_STATE: "false",
  DISCORD_MODE: "dry-run",
  ACTIVE_STORES: "maxireves,oupi,pixelheart,fantasy-sphere,ludisphere,parkage,ultrajeux,playin,philibert,cultura,micromania,fnac,leclerc,carrefour,king-jouet,joueclub,amazon-fr,mystic-ambre,ludiworld,vegastore,plaza-tcg,otakuland,esprit-jeu,la-grande-recre,bcd-jeux"
};

async function json(path: string, env: Env = safeEnv, init?: RequestInit) {
  const response = await worker.fetch(new Request(`https://preview.test${path}`, init), env);
  return { response, body: await response.json() as Record<string, any> };
}

describe("routes SAFE Preview", () => {
  it("expose racine, health et config avec les protections verrouillées", async () => {
    const root = await json("/");
    expect(root.response.status).toBe(200);
    expect(root.body).toMatchObject({
      deployment: "SAFE_PREVIEW",
      runtime: {
        monitoringEnabled: false,
        automaticPolling: false,
        stateWritesEnabled: false,
        discordMode: "dry-run"
      }
    });

    const health = await json("/health");
    expect(health.body.status).toBe("ok");
    expect(health.body.stores).toHaveLength(25);

    const config = await json("/config");
    expect(config.body.opWatchV1.officialCatalogUrl).toBe("https://fr.onepiece-cardgame.com/products/");
    expect(config.body.stores).toHaveLength(25);
    expect(JSON.stringify(config.body)).not.toContain("AUTHORIZED_FEED_PLAYIN_URL=https");
  });

  it("valide sémantiquement le calendrier officiel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>PRODUITS | ONE PIECE CARD GAME</title></head><body>
        <h1>PRODUITS ONE PIECE CARD GAME</h1>
        <article>BOOSTER [OP-17] Date de sortie 28 août 2026</article>
        <nav>1 / 1</nav>
      </body></html>
    `, { status: 200 })));

    const calendar = await json("/opwatch/v1/calendar");
    expect(calendar.response.status).toBe(200);
    expect(calendar.body).toMatchObject({
      mode: "SAFE_CALENDAR_PREVIEW",
      sourcePages: 1,
      catalogProductsParsed: 1
    });
    expect(calendar.body.activeProducts[0]).toMatchObject({
      id: "OP-17",
      releaseDate: "2026-08-28",
      watchWindow: { active: true }
    });
  });

  it("garde l'audit fermé sans flag puis exige un jeton même avec le flag", async () => {
    expect((await json("/audit?store=playin")).response.status).toBe(403);
    const tokenEnv = {
      ...safeEnv,
      ALLOW_PUBLIC_AUDIT: "true",
      PREVIEW_AUDIT_TOKEN: "test-token"
    };
    expect((await json("/audit?store=playin", tokenEnv)).response.status).toBe(401);

    const authorized = await json("/audit?store=playin", tokenEnv, {
      headers: { Authorization: "Bearer test-token" }
    });
    expect(authorized.response.status).toBe(200);
    expect(authorized.body.stores[0]).toMatchObject({
      store: "playin",
      configuredStatus: "pending_authorized_feed",
      runtimeStatus: "pending",
      sources: []
    });
  });

  it("refuse toute méthode non GET", async () => {
    expect((await json("/", safeEnv, { method: "POST" })).response.status).toBe(405);
  });
});
