import { afterEach, describe, expect, it, vi } from "vitest";
import { auditStore } from "../src/storeAudit";
import { buildDiscordPayload } from "../src/discord";
import { CONNECTORS } from "../src/connectors";
import type { AlertMatch, Env, ProductCandidate } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function alertMatch(candidate: ProductCandidate): AlertMatch {
  const detectedAt = "2026-08-10T16:00:00.000Z";
  return {
    rule: {
      id: "test-rule",
      label: "test",
      enabled: true,
      productIds: ["OP17"],
      stores: ["*"],
      languages: ["Français confirmé"],
      events: ["new_listing"],
      availabilities: ["available"],
      notifyOnInitialDiscovery: true
    },
    matchedProductIds: candidate.matchedReferences,
    change: {
      id: "change-1",
      type: "new_listing",
      initial: true,
      detectedAt,
      candidate,
      current: {
        key: "snapshot-1",
        store: candidate.store,
        storeName: candidate.storeName,
        title: candidate.title,
        url: candidate.url,
        matchedReferences: candidate.matchedReferences,
        availability: candidate.availability,
        language: candidate.language,
        priceText: candidate.priceText,
        firstSeenAt: detectedAt,
        lastSeenAt: detectedAt
      }
    }
  };
}

describe("Parkage public structured catalog", () => {
  it("reste authoritative en Discovery et en Fast Watch minute", () => {
    const connector = CONNECTORS.find((item) => item.key === "parkage");
    expect(connector).toBeDefined();
    expect(connector?.authoritativeStructuredFeed).toBe(true);
    expect(connector?.followDiscoveredProductPages).toBe(false);
  });

  it("qualifie uniquement les produits FR et conserve stock/prix", async () => {
    const connector = CONNECTORS.find((item) => item.key === "parkage");
    expect(connector).toBeDefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      type: "success",
      data: {
        list: [
          { id: 1116911, name: "Deck pour débutant One Piece Card Game - ST-33 : Bleu - Kuzan", name_fr: "Deck pour débutant One Piece Card Game - ST-33 : Bleu - Kuzan", name_en: "Starter Deck ST-33 Blue Kuzan", lang: "fr", price: 19, stock: 11 },
          { id: 1116905, name: "One Piece Card Game Starter Deck - ST-33 : Blue - Kuzan", name_fr: "Deck pour débutant One Piece Card Game - ST-33 : Bleu - Kuzan", lang: "en", price: 19, stock: 9 }
        ]
      }
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const audit = await auditStore(connector!, {} as Env);
    expect(audit.sourceKind).toBe("public_structured_feed");
    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      externalId: "1116911",
      matchedReferences: ["ST-33"],
      language: "Français confirmé",
      availability: "available",
      priceText: "19,00 €",
      commercialEligible: true
    });
    expect(audit.candidates[0].url).toContain("/1116911-");
  });

  it("garde une référence FR en rupture pour détecter son futur retour en stock", async () => {
    const connector = CONNECTORS.find((item) => item.key === "parkage")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      type: "success",
      data: { list: [{ id: 1116910, name_fr: "Deck pour débutant One Piece Card Game - ST-32 : Vert - Roronoa Zoro", lang: "fr", price: 24, stock: 0 }] }
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const audit = await auditStore(connector, {} as Env);
    expect(audit.candidates[0].availability).toBe("unavailable");
    expect(audit.candidates[0].commercialEligible).toBe(true);
  });
});

describe("E.Leclerc marketplace alerts", () => {
  const baseCandidate: ProductCandidate = {
    store: "leclerc",
    storeName: "E.Leclerc",
    title: "Display One Piece OP17 Français",
    url: "https://www.e.leclerc/fp/display-one-piece-op17",
    sourceUrl: "https://www.e.leclerc/fp/display-one-piece-op17",
    matchedReferences: ["OP17"],
    availability: "available",
    language: "Français confirmé",
    priceText: "119,90 €",
    commercialEligible: true,
    excerpt: ""
  };

  it("affiche explicitement vendeur non confirmé quand il est inconnu", () => {
    const payload = buildDiscordPayload(alertMatch(baseCandidate));
    const seller = payload.embeds[0].fields.find((field) => field.name.includes("Vendeur"));
    expect(seller?.value).toMatch(/Vendeur non confirmé.*E\.Leclerc/i);
  });

  it("affiche le vendeur réel quand il est connu", () => {
    const payload = buildDiscordPayload(alertMatch({ ...baseCandidate, seller: "Boutique Partenaire" }));
    const seller = payload.embeds[0].fields.find((field) => field.name.includes("Vendeur"));
    expect(seller?.value).toBe("Boutique Partenaire");
  });

  it("exige explicitement un vendeur E.Leclerc dans la définition du connecteur", () => {
    const connector = CONNECTORS.find((item) => item.key === "leclerc")!;
    expect(connector.requiredSellerPatterns).toHaveLength(2);
    expect(connector.requiredSellerLabel).toBe("E.Leclerc");
  });

  it("reste fail-closed sur une fiche sans preuve vendeur", async () => {
    const base = CONNECTORS.find((item) => item.key === "leclerc")!;
    const source = "https://www.e.leclerc/fp/display-one-piece-op17-123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Display One Piece OP17 Français</h1>
        <p>En stock — 119,90 €</p>
      </body></html>
    `, { status: 200 })));

    const audit = await auditStore({ ...base, sources: [source] }, {} as Env);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/E\.Leclerc non confirmé/i);
  });

  it("accepte seulement la preuve vendeur officielle sur la fiche directe", async () => {
    const base = CONNECTORS.find((item) => item.key === "leclerc")!;
    const source = "https://www.e.leclerc/fp/display-one-piece-op17-123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>One Piece Card Game</title></head><body>
        <h1>Display One Piece OP17 Français</h1>
        <p>En stock — 119,90 €</p><p>Vendu et expédié par E.Leclerc</p>
      </body></html>
    `, { status: 200 })));

    const audit = await auditStore({ ...base, sources: [source] }, {} as Env);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(true);
  });
});
