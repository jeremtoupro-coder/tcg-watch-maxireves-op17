import type { ConnectorDefinition } from "../types";

export const oupi: ConnectorDefinition = {
  key: "oupi",
  name: "Oupi",
  sources: [
    "https://oupi.eu/fr/413-precommande-one-piece?q=Langue-Fran%C3%A7ais",
    "https://oupi.eu/fr/414-display-one-piece",
    "https://oupi.eu/fr/513-case-scelle-de-display",
    "https://oupi.eu/fr/415-starter-deck-one-piece",
    "https://oupi.eu/fr/417-collection-pack-speciaux-one-piece"
  ],
  productUrlPatterns: [/\/\d+-[^/?#]+\.html(?:[?#].*)?$/i],
  responseMustContainAny: [/one[\s-]*piece/i],
  maxConcurrency: 2,
  requestHeaders: {
    "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
  },
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 16,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "PrestaShop confirmé par les routes et la structure publique.",
    "Les catégories publiques couvrent précommandes, displays, cases, starters et packs spéciaux.",
    "Les résultats de catégorie servent à découvrir les URLs ; la fiche produit directe reste la source de vérité pour stock et langue.",
    "Le profil HTTP OPWatch explicite a été validé en HTTP 200 depuis le runtime Cloudflare alors qu'un User-Agent imitant Chrome déclenchait le WAF en HTTP 403.",
    "Un HTTP 403/429/5xx doit dégrader la source et ne doit jamais être interprété comme une rupture de stock."
  ]
};
