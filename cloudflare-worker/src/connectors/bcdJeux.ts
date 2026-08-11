import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const bcdJeux: ConnectorDefinition = {
  key: "bcd-jeux",
  name: "BCD Jeux",
  sources: [
    "https://www.bcd-jeux.fr/511808-one-piece-tcg"
  ],
  productUrlPatterns: [/\/one-piece-tcg\/\d+-[^/?#]+\.html/i],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catégorie publique One Piece TCG dédiée avec boosters, displays et Starter Decks.",
    "Les fiches directes exposent explicitement édition FR/EN, prix et état En stock/Rupture/Précommande.",
    "Candidature Affilae en attente : un flux partenaire pourra compléter ou remplacer la Discovery HTML lorsqu'il sera disponible.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
