import { describe, expect, it } from "vitest";
import { validateWatchConfig, WATCH_CONFIG } from "../src/config";
import type { WatchConfig } from "../src/types";

function cloneConfig(): WatchConfig {
  return JSON.parse(JSON.stringify(WATCH_CONFIG)) as WatchConfig;
}

describe("configuration des alertes", () => {
  it("valide la configuration actuelle", () => {
    expect(validateWatchConfig(cloneConfig())).toBeDefined();
  });

  it("permet de désactiver une alerte sans la supprimer", () => {
    const config = cloneConfig();
    config.alerts[0].enabled = false;

    const validated = validateWatchConfig(config);
    expect(validated.alerts[0].enabled).toBe(false);
  });

  it("permet d'ajouter une nouvelle référence sans modifier le moteur", () => {
    const config = cloneConfig();
    config.products.push({
      id: "OP19",
      label: "One Piece Card Game OP19",
      enabled: true,
      aliases: ["OP19", "OP-19", "OP 19"]
    });
    config.alerts.push({
      id: "op19-stock",
      label: "OP19 disponible",
      enabled: true,
      productIds: ["OP19"],
      stores: ["*"],
      languages: ["Français confirmé", "Langue non précisée"],
      events: ["back_in_stock", "preorder_opened"],
      availabilities: ["available", "preorder"],
      notifyOnInitialDiscovery: false
    });

    expect(validateWatchConfig(config).products.at(-1)?.id).toBe("OP19");
  });

  it("refuse une alerte reliée à un produit inconnu", () => {
    const config = cloneConfig();
    config.alerts[0].productIds = ["INCONNU"];

    expect(() => validateWatchConfig(config)).toThrow(/produit inconnu/i);
  });
});
