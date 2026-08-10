import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const philibert: ConnectorDefinition = {
  key: "philibert",
  name: "Philibert",
  sources: [
    "https://www.philibertnet.com/fr/15860-one-piece-le-jeu-de-cartes"
  ],
  productUrlPatterns: [/\/fr\/[^/]+\/\d+-[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 12,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Catégorie française One Piece Card Game actuelle (15860).",
    "La catégorie publique expose les produits, la langue et le vendeur Philibert ; la fiche directe reste la source de vérité pour stock/prix.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture. Si l'origine bloque durablement Cloudflare, bascule prévue vers un flux partenaire Affilae autorisé plutôt qu'un contournement anti-bot."
  ]
};
