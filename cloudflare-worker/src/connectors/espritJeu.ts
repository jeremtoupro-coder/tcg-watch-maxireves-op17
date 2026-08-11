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
  maxDiscoveredProductPages: 50,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catégorie publique dédiée au One Piece Card Game avec prix et disponibilité visibles sans authentification.",
    "Les fiches directes confirment la référence, la langue, le prix et l'état stock/précommande avant toute alerte.",
    "ONE PIECE ALL exploite la Discovery complète de la catégorie (jusqu'à la limite de sûreté de 50 fiches) afin de mémoriser les anciennes références et détecter leurs restocks.",
    "Le partenariat Affilae est validé mais n'est pas requis pour la surveillance personnelle tant que la source publique reste exploitable.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
