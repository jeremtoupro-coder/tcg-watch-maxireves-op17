import { describe, expect, it, vi, afterEach } from "vitest";
import { CONNECTORS } from "../src/connectors";
import {
  auditStore,
  configuredStoreStatus,
  hasConfiguredAuthorizedFeed
} from "../src/storeAudit";
import type { Env } from "../src/types";

const PROTECTED_FEEDS: Record<string, string> = {
  playin: "AUTHORIZED_FEED_PLAYIN_URL",
  cultura: "AUTHORIZED_FEED_CULTURA_URL",
  micromania: "AUTHORIZED_FEED_MICROMANIA_URL",
  fnac: "AUTHORIZED_FEED_FNAC_URL",
  carrefour: "AUTHORIZED_FEED_CARREFOUR_URL",
  "king-jouet": "AUTHORIZED_FEED_KING_JOUET_URL"
};

const OPTIONAL_PARTNER_FEEDS: Record<string, string> = {
  joueclub: "AUTHORIZED_FEED_JOUECLUB_URL",
  "la-grande-recre": "AUTHORIZED_FEED_LA_GRANDE_RECRE_URL",
  "bcd-jeux": "AUTHORIZED_FEED_BCD_JEUX_URL"
};

const ALL_FEEDS = { ...PROTECTED_FEEDS, ...OPTIONAL_PARTNER_FEEDS };

afterEach(() => vi.unstubAllGlobals());

describe("flux partenaires et boutiques protégées", () => {
  it("déclare les six feeds anti-bot et les trois feeds Affilae optionnels", () => {
    const feedConnectors = CONNECTORS.filter((connector) => connector.authorizedFeedEnv);
    expect(Object.fromEntries(feedConnectors.map((connector) => [connector.key, connector.authorizedFeedEnv]))).toEqual(ALL_FEEDS);

    const protectedConnectors = feedConnectors.filter((connector) => connector.directPollingDisabledWithoutFeed === true);
    expect(Object.fromEntries(protectedConnectors.map((connector) => [connector.key, connector.authorizedFeedEnv]))).toEqual(PROTECTED_FEEDS);

    const optionalConnectors = feedConnectors.filter((connector) => connector.directPollingDisabledWithoutFeed !== true);
    expect(Object.fromEntries(optionalConnectors.map((connector) => [connector.key, connector.authorizedFeedEnv]))).toEqual(OPTIONAL_PARTNER_FEEDS);
  });

  it("conserve Ludisphere sur son flux Shopify public validé", () => {
    const ludisphere = CONNECTORS.find((connector) => connector.key === "ludisphere");
    expect(ludisphere).toBeDefined();
    expect(ludisphere?.sources).toEqual([
      "https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250"
    ]);
    expect(ludisphere?.authorizedFeedEnv).toBeUndefined();
  });

  it("active Otakuland sur sa vraie boutique TCG", () => {
    const otakuland = CONNECTORS.find((connector) => connector.key === "otakuland");
    expect(otakuland).toBeDefined();
    expect(otakuland?.commercialAlertsEnabled).not.toBe(false);
    expect(configuredStoreStatus(otakuland!, {})).toBe("active_fast_watch");
    expect(otakuland?.sources).toContain("https://otakuland-mangapassion.com/catalogue/310073-TCG-One-Piece");
    expect(otakuland?.sources.some((source) => source.includes("otakuland.fr"))).toBe(false);
  });

  it("classe un marchand protégé sans secret en attente de flux sans requête réseau", async () => {
    const playin = CONNECTORS.find((connector) => connector.key === "playin")!;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditStore(playin, {});
    expect(configuredStoreStatus(playin, {})).toBe("pending_authorized_feed");
    expect(audit).toMatchObject({
      configuredStatus: "pending_authorized_feed",
      runtimeStatus: "pending",
      sourceKind: "none",
      fastWatchCapable: false,
      commercialEligible: false
    });
    expect(audit.sources).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("garde JouéClub actif sur le public même avant configuration de son feed", () => {
    const joueclub = CONNECTORS.find((connector) => connector.key === "joueclub")!;
    expect(joueclub.authorizedFeedEnv).toBe("AUTHORIZED_FEED_JOUECLUB_URL");
    expect(joueclub.directPollingDisabledWithoutFeed).not.toBe(true);
    expect(configuredStoreStatus(joueclub, {})).toBe("active_fast_watch");
    expect(hasConfiguredAuthorizedFeed(joueclub, {})).toBe(false);
  });

  it("bascule JouéClub sur le flux partenaire lorsqu'il est configuré", async () => {
    const joueclub = CONNECTORS.find((connector) => connector.key === "joueclub")!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://feed.example/joueclub.xml");
      return new Response(
        "<products><product><title>One Piece OP17 Display FR</title><url>https://www.joueclub.fr/one-piece/display-op17-12345678.html</url><price>129.90</price><stock>1</stock><language>français</language></product></products>",
        { status: 200, headers: { "content-type": "application/xml" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditStore(joueclub, {
      AUTHORIZED_FEED_JOUECLUB_URL: "https://feed.example/joueclub.xml"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.sourceKind).toBe("authorized_feed");
    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].matchedReferences).toContain("OP-17");
    expect(audit.candidates[0].availability).toBe("available");
  });

  it("retombe sur la source publique si un feed Affilae optionnel tombe", async () => {
    const bcd = CONNECTORS.find((connector) => connector.key === "bcd-jeux")!;
    const product = "https://www.bcd-jeux.fr/one-piece-tcg/39999-one-piece-op17-display-24-boosters-fr-4580000000000.html";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://feed.example/bcd.csv") {
        return new Response("indisponible", { status: 503, headers: { "content-type": "text/plain" } });
      }
      if (url === product) {
        return new Response("<html><body><h1>One Piece OP17 Display 24 boosters Français</h1><p>129,90 €</p><p>En Stock</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }
      return new Response(`<html><body>One Piece TCG <a href="${product}">OP17 Display</a></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditStore(bcd, {
      AUTHORIZED_FEED_BCD_JEUX_URL: "https://feed.example/bcd.csv"
    });

    expect(audit.sourceKind).toBe("public_html");
    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.notes.some((note) => /fallback public/i.test(note))).toBe(true);
    expect(audit.candidates.some((candidate) => candidate.matchedReferences.includes("OP-17"))).toBe(true);
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

  it("garde aussi Cultura fail-closed sans vendeur Cultura explicite", async () => {
    const cultura = CONNECTORS.find((connector) => connector.key === "cultura")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://www.cultura.com/p-op17-1.html,149.90,disponible,français,Vendeur Partenaire",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));

    const audit = await auditStore(cultura, {
      AUTHORIZED_FEED_CULTURA_URL: "https://feed.example/cultura.csv"
    });

    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Cultura non confirmé/i);
  });
});
