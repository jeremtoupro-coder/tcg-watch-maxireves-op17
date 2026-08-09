import { describe, expect, it, vi, afterEach } from "vitest";
import { CONNECTORS } from "../src/connectors";
import { auditStore, hasConfiguredAuthorizedFeed } from "../src/storeAudit";
import type { Env } from "../src/types";

const EXPECTED_FEEDS: Record<string, string> = {
  playin: "AUTHORIZED_FEED_PLAYIN_URL",
  cultura: "AUTHORIZED_FEED_CULTURA_URL",
  micromania: "AUTHORIZED_FEED_MICROMANIA_URL",
  fnac: "AUTHORIZED_FEED_FNAC_URL",
  carrefour: "AUTHORIZED_FEED_CARREFOUR_URL",
  "king-jouet": "AUTHORIZED_FEED_KING_JOUET_URL"
};

afterEach(() => vi.unstubAllGlobals());

describe("remédiation des boutiques protégées", () => {
  it("déclare exactement les six flux partenaires attendus", () => {
    const protectedConnectors = CONNECTORS.filter((connector) => connector.authorizedFeedEnv);
    expect(Object.fromEntries(protectedConnectors.map((connector) => [connector.key, connector.authorizedFeedEnv]))).toEqual(EXPECTED_FEEDS);
    expect(protectedConnectors.every((connector) => connector.directPollingDisabledWithoutFeed === true)).toBe(true);
  });

  it("conserve Ludisphere sur son flux Shopify public validé", () => {
    const ludisphere = CONNECTORS.find((connector) => connector.key === "ludisphere");
    expect(ludisphere).toBeDefined();
    expect(ludisphere?.sources).toEqual([
      "https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250"
    ]);
    expect(ludisphere?.authorizedFeedEnv).toBeUndefined();
  });

  it("maintient Otakuland en découverte uniquement", () => {
    const otakuland = CONNECTORS.find((connector) => connector.key === "otakuland");
    expect(otakuland?.commercialAlertsEnabled).toBe(false);
  });

  it("détecte uniquement un flux réellement configuré", () => {
    const playin = CONNECTORS.find((connector) => connector.key === "playin");
    expect(playin).toBeDefined();
    expect(hasConfiguredAuthorizedFeed(playin!, {})).toBe(false);
    expect(hasConfiguredAuthorizedFeed(playin!, {
      AUTHORIZED_FEED_PLAYIN_URL: "https://feed.example/playin.csv"
    })).toBe(true);
  });

  it("bascule l'audit Playin vers le flux autorisé sans appeler l'origine protégée", async () => {
    const playin = CONNECTORS.find((connector) => connector.key === "playin");
    expect(playin).toBeDefined();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://feed.example/playin.csv");
      return new Response(
        "title,url,price,stock,language\nOne Piece OP17 Display FR,https://www.play-in.com/fr/produit/999999/op17,129.90,en stock,français",
        { status: 200, headers: { "content-type": "text/csv" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const env: Env = {
      AUTHORIZED_FEED_PLAYIN_URL: "https://feed.example/playin.csv"
    };
    const audit = await auditStore(playin!, env);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.sources[0].sourceUrl).toBe("authorized-feed:playin");
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].language).toBe("Français confirmé");
  });

  it("garde Fnac fail-closed lorsqu'un vendeur tiers contient seulement le mot Fnac dans son nom", async () => {
    const fnac = CONNECTORS.find((connector) => connector.key === "fnac");
    expect(fnac).toBeDefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://www.fnac.com/x,149.90,disponible,français,Super Boutique Fnac Occasion",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));

    const audit = await auditStore(fnac!, {
      AUTHORIZED_FEED_FNAC_URL: "https://feed.example/fnac.csv"
    });

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
  });
});
