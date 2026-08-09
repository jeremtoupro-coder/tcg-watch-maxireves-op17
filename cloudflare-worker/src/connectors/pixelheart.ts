import type { ConnectorDefinition } from "../types";

export const pixelheart: ConnectorDefinition = {
  key: "pixelheart",
  name: "PixelHeart",
  sources: [
    "https://www.pixelheart.eu/fr/boutique/",
    "https://www.pixelheart.eu/fr/boutique/?pa_section=collectible",
    "https://www.pixelheart.eu/fr/produit/one-piece-card-game-boite-de-boosters-francais-display-op17-les-plus-puissants-des-guerriers/"
  ],
  productUrlPatterns: [/\/fr\/produit\//i],
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catalogue et fiche OP17 FR contrôlés directement en mode lecture seule.",
    "La fiche directe reste surveillable même si elle disparaît temporairement de la recherche interne."
  ]
};
