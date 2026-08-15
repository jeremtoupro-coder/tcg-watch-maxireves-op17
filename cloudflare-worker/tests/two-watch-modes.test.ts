import { describe, expect, it } from "vitest";
import { buildDiscordPayload } from "../src/discord";
import { evaluateCandidates } from "../src/engine";
import { MemoryStateStore, scopedStateStore } from "../src/state";
import { buildAllOnePieceWatchConfig, candidateForAllOnePiece } from "../src/watchModes";
import type { AlertMatch, ProductCandidate } from "../src/types";

function candidate(reference: string, availability: ProductCandidate["availability"], title?: string): ProductCandidate {
  return {
    store: "esprit-jeu",
    storeName: "Esprit Jeu",
    title: title ?? `One Piece - Display ${reference} Français`,
    url: `https://www.espritjeu.com/one-piece-display-${reference.toLowerCase().replace("-", "")}.html`,
    sourceUrl: `https://www.espritjeu.com/one-piece-display-${reference.toLowerCase().replace("-", "")}.html`,
    matchedReferences: [reference],
    availability,
    language: "Français confirmé",
    priceText: "149,90 €",
    commercialEligible: true,
    excerpt: `One Piece Card Game ${reference} Français ${availability === "available" ? "En stock" : "Rupture de stock"}`
  };
}

describe("séparation des deux veilles", () => {
  it("qualifie une ancienne référence pour ONE PIECE ALL et rejette un accessoire", () => {
    const oldSet = candidateForAllOnePiece(candidate("OP-09", "unavailable"));
    expect(oldSet?.matchedReferences).toEqual(["OP-09"]);
    expect(oldSet?.format).toBe("display");

    const sleeves = candidate("OP-09", "available", "Sleeves One Piece OP09 Français");
    sleeves.excerpt = "Protège-cartes / sleeves officiels One Piece OP09";
    expect(candidateForAllOnePiece(sleeves)).toBeUndefined();
  });

  it("mémorise les sorties actives dans ALL mais les exclut de ses alertes", () => {
    const op17 = candidateForAllOnePiece(candidate("OP-17", "available"))!;
    const op09 = candidateForAllOnePiece(candidate("OP-09", "available"))!;
    const config = buildAllOnePieceWatchConfig([op17, op09], ["OP-17"]);

    expect(config.alerts[0].scope).toBe("one_piece_all");
    expect(config.alerts[0].events).toEqual(["new_listing", "back_in_stock"]);
    expect(config.alerts[0].availabilities).toEqual(["available"]);
    expect(config.alerts[0].productIds).toContain("OP-09");
    expect(config.alerts[0].productIds).not.toContain("OP-17");
    expect(config.products.map((product) => product.id)).toEqual(["OP-09", "OP-17"]);
  });

  it("ne classe pas une future référence marchande non publiée comme historique", () => {
    const op18 = candidate("OP-18", "available");
    expect(candidateForAllOnePiece(
      op18,
      ["Français confirmé"],
      90,
      ["OP-01", "OP-09", "OP-17", "EB-05"]
    )).toBeUndefined();

    expect(candidateForAllOnePiece(
      candidate("OP-09", "available"),
      ["Français confirmé"],
      90,
      ["OP-01", "OP-09", "OP-17", "EB-05"]
    )?.matchedReferences).toEqual(["OP-09"]);
  });

  it("baseline ALL silencieuse puis alerte uniquement sur un vrai restock historique", async () => {
    const root = new MemoryStateStore({ writable: true });
    const allState = scopedStateStore(root, "one-piece-all");
    const unavailable = candidateForAllOnePiece(candidate("OP-09", "unavailable"))!;
    const firstConfig = buildAllOnePieceWatchConfig([unavailable], ["OP-17"]);

    const first = await evaluateCandidates([unavailable], {
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    }, {
      config: firstConfig,
      stateStore: allState,
      baselineStores: ["esprit-jeu"],
      claimSettleMs: 0,
      now: "2026-08-11T12:00:00.000Z"
    });

    expect(first.alertMatches).toEqual([]);
    expect(first.state.baselines["esprit-jeu"].markedComplete).toBe(true);

    const available = candidateForAllOnePiece(candidate("OP-09", "available"))!;
    const secondConfig = buildAllOnePieceWatchConfig([available], ["OP-17"]);
    const second = await evaluateCandidates([available], {
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    }, {
      config: secondConfig,
      stateStore: allState,
      baselineStores: ["esprit-jeu"],
      claimSettleMs: 0,
      now: "2026-08-11T12:15:00.000Z"
    });

    expect(second.alertMatches).toHaveLength(1);
    expect(second.alertMatches[0].change.type).toBe("back_in_stock");
    expect(second.alertMatches[0].rule.scope).toBe("one_piece_all");
    expect(buildDiscordPayload(second.alertMatches[0]).embeds[0].title).toContain("ONE PIECE ALL");
  });

  it("prend le relais après la fenêtre Nouvelles sorties sans faux new_listing", async () => {
    const root = new MemoryStateStore({ writable: true });
    const allState = scopedStateStore(root, "one-piece-all");
    const op17 = candidateForAllOnePiece(candidate("OP-17", "available"))!;

    const whileActive = await evaluateCandidates([op17], {
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    }, {
      config: buildAllOnePieceWatchConfig([op17], ["OP-17"]),
      stateStore: allState,
      baselineStores: ["esprit-jeu"],
      now: "2026-09-30T12:00:00.000Z",
      claimSettleMs: 0
    });
    expect(whileActive.alertMatches).toEqual([]);

    const afterWindow = await evaluateCandidates([op17], {
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    }, {
      config: buildAllOnePieceWatchConfig([op17], []),
      stateStore: allState,
      baselineStores: ["esprit-jeu"],
      now: "2026-10-01T12:00:00.000Z",
      claimSettleMs: 0
    });
    expect(afterWindow.changes).toEqual([]);
    expect(afterWindow.alertMatches).toEqual([]);
  });

  it("rend une règle historique sans scope comme une alerte Nouvelles sorties", () => {
    const current = {
      key: "product:v3:test",
      store: "esprit-jeu",
      storeName: "Esprit Jeu",
      title: "Display OP-17 Français",
      url: "https://www.espritjeu.com/one-piece-display-op17.html",
      matchedReferences: ["OP-17"],
      format: "display" as const,
      availability: "available" as const,
      language: "Français confirmé" as const,
      priceText: "179,90 €",
      priceCents: 17990,
      firstSeenAt: "2026-08-11T12:00:00.000Z",
      lastSeenAt: "2026-08-11T12:01:00.000Z"
    };
    const match: AlertMatch = {
      rule: {
        id: "legacy-release-rule",
        label: "legacy",
        enabled: true,
        productIds: ["OP-17"],
        stores: ["*"],
        languages: ["Français confirmé"],
        events: ["back_in_stock"],
        availabilities: ["available"],
        notifyOnInitialDiscovery: false
      },
      matchedProductIds: ["OP-17"],
      change: {
        id: "change",
        type: "back_in_stock",
        initial: false,
        detectedAt: "2026-08-11T12:01:00.000Z",
        candidate: candidateForAllOnePiece(candidate("OP-17", "available"))!,
        current
      }
    };

    expect(buildDiscordPayload(match).embeds[0].title).toContain("NOUVELLE SORTIE");
  });
});
