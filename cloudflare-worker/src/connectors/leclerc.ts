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
  notes: [
    "Marketplace E.Leclerc autorisée : le vendeur est informatif mais n'est plus un motif de rejet.",
    "OP Watch ne prétend jamais qu'une offre est vendue par E.Leclerc sans preuve."
  ]
};
