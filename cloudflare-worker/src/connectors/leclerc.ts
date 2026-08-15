import type { ConnectorDefinition } from "../types";

export const leclerc: ConnectorDefinition = {
  key: "leclerc",
  name: "E.Leclerc",
  sources: ["https://www.e.leclerc/recherche?q=one%20piece%20booster"],
  productUrlPatterns: [/\/fp\/[^?#]+/i],
  requestHeaders: {
    "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
  },
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  requiredSellerPatterns: [
    /\bvendu(?:e)?(?:\s+et\s+(?:exp[eé]di[eé]|livr[eé])(?:e)?)?\s+par\s*:?[\s-]*e\.?\s*leclerc\b/i,
    /\bsnc\s+lcommerce\b/i
  ],
  requiredSellerLabel: "E.Leclerc",
  notes: [
    "Marketplace : une fiche directe et une preuve explicite du vendeur E.Leclerc/SNC LCommerce sont obligatoires.",
    "Toute offre tierce ou sans vendeur vérifiable reste observée mais ne peut pas déclencher Discord."
  ]
};
