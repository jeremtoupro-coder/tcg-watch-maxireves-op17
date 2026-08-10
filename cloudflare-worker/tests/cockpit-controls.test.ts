import { describe, expect, it } from "vitest";
import {
  applyRuntimeControlConfig,
  defaultRuntimeControlConfig,
  extraStoreSources,
  normalizeRuntimeControlConfig
} from "../src/controlPlane";
import { candidateForActiveProducts, type OfficialProduct } from "../src/opwatchV1";
import type { ProductCandidate } from "../src/types";

const official: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER [OP-17]",
  releaseDate: "2026-08-28",
  aliases: ["OP-17", "OP17", "OP 17"]
};

describe("cockpit runtime controls", () => {
  it("garde le français comme langue par défaut", () => {
    expect(defaultRuntimeControlConfig().languages).toEqual(["Français confirmé"]);
  });

  it("peut désactiver une référence officielle immédiatement", () => {
    const config = defaultRuntimeControlConfig();
    config.productOverrides["OP-17"] = { enabled: false };
    expect(applyRuntimeControlConfig([official], config, new Date("2026-08-10T12:00:00Z"))).toEqual([]);
  });

  it("respecte un cutoff manuel antérieur au cutoff officiel", () => {
    const config = defaultRuntimeControlConfig();
    config.productOverrides["OP-17"] = { stopAt: "2026-08-09" };
    expect(applyRuntimeControlConfig([official], config, new Date("2026-08-10T12:00:00Z"))).toEqual([]);
  });

  it("ajoute une référence manuelle d'un autre jeu avec des URLs boutique", () => {
    const config = normalizeRuntimeControlConfig({
      version: 1,
      updatedAt: "2026-08-10T12:00:00Z",
      languages: ["Français confirmé"],
      productOverrides: {},
      assistantRequests: [],
      manualProducts: [{
        id: "ME-02",
        label: "Pokémon Mega Evolution 02",
        game: "pokemon",
        aliases: ["ME-02", "Mega Evolution 02"],
        enabled: true,
        releaseDate: "2026-10-01",
        startsAt: "2026-08-01",
        stopAt: "2026-11-01",
        storeUrls: { philibert: ["https://www.philibertnet.com/fr/exemple-me02"] }
      }]
    }, new Date("2026-08-10T12:00:00Z"));
    const products = applyRuntimeControlConfig([], config, new Date("2026-08-10T12:00:00Z"));
    expect(products[0]).toMatchObject({ id: "ME-02", family: "OTHER", label: "Pokémon Mega Evolution 02" });
    expect(extraStoreSources(config).philibert).toEqual(["https://www.philibertnet.com/fr/exemple-me02"]);
  });

  it("n'accepte que les langues cockpit prévues", () => {
    const config = normalizeRuntimeControlConfig({
      version: 1,
      updatedAt: "2026-08-10T12:00:00Z",
      languages: ["Français confirmé", "Anglais détecté", "Allemand détecté"],
      productOverrides: {},
      manualProducts: [],
      assistantRequests: []
    });
    expect(config.languages).toEqual(["Français confirmé", "Anglais détecté"]);
  });

  it("autorise réellement une offre anglaise lorsque EN est activé", () => {
    const candidate: ProductCandidate = {
      store: "philibert",
      storeName: "Philibert",
      title: "One Piece OP-17 Display English",
      url: "https://example.test/op17-en",
      sourceUrl: "https://example.test/op17-en",
      matchedReferences: ["OP-17"],
      format: "display",
      availability: "available",
      language: "Anglais détecté",
      commercialEligible: true,
      excerpt: "English display OP-17 in stock"
    };
    expect(candidateForActiveProducts(candidate, [official])).toBeUndefined();
    expect(candidateForActiveProducts(candidate, [official], ["Français confirmé", "Anglais détecté"]))
      .toMatchObject({ language: "Anglais détecté", matchedReferences: ["OP-17"] });
  });
});
