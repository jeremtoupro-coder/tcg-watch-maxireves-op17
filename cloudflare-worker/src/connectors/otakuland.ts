import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const otakuland: ConnectorDefinition = {
  key: "otakuland",
  name: "Otakuland",
  sources: [
    "https://otakuland-mangapassion.com/catalogue/310073-TCG-One-Piece",
    "https://otakuland-mangapassion.com/catalogue/368729-Anglais",
    "https://otakuland-mangapassion.com/catalogue/353297-One-Piece-Japonais"
  ],
  productUrlPatterns: [/https?:\/\/(?:www\.)?otakuland-mangapassion\.com\/\d{6,}-[^?#/]+/i],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 12,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Domaine marchand TCG réel : otakuland-mangapassion.com (l'ancien otakuland.fr n'est pas la boutique TCG à surveiller).",
    "Catégories One Piece dédiées FR / EN / JP ; le filtre de langues du runtime décide lesquelles sont commercialement éligibles.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
