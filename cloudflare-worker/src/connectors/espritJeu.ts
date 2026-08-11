import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const espritJeu: ConnectorDefinition = {
  key: "esprit-jeu",
  name: "Esprit Jeu",
  sources: [
    "https://www.espritjeu.com/cartes-et-jcc/one-piece-le-jeu-de-cartes.html"
  ],
  productUrlPatterns: [/\/one-piece-[^/?#]+\.html/i],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catégorie publique dédiée au One Piece Card Game avec prix et disponibilité visibles sans authentification.",
    "Les fiches directes confirment la référence, la langue, le prix et l'état stock/précommande avant toute alerte.",
    "Candidature Affilae en attente : un flux partenaire pourra remplacer ou compléter la Discovery HTML lorsqu'il sera disponible.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
