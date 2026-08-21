import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const plazaTcg: ConnectorDefinition = {
  key: "plaza-tcg",
  name: "Plaza TCG",
  sources: [
    "https://plazatcg.com/5-one-piece",
    "https://plazatcg.com/display/2189-one-piece-display-les-guerriers-les-plus-puissants-au-monde-op17-francais-4582770058710.html"
  ],
  productUrlPatterns: [
    /\/[a-z0-9-]+\/\d+-[^?#]+\.html(?:$|[?#])/i
  ],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catalogue One Piece PrestaShop public ; les fiches directes valident langue, prix et disponibilité avant alerte.",
    "Fiche OP17 FR témoin suivie en plus du catalogue pour sécuriser le lancement du 28 août 2026."
  ]
};
