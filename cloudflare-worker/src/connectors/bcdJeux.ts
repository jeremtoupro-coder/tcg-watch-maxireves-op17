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
  authorizedFeedEnv: "AUTHORIZED_FEED_BCD_JEUX_URL",
  notes: [
    "Catégorie publique One Piece TCG dédiée avec boosters, displays et Starter Decks.",
    "Flux produit Affilae/BeezUP autorisé disponible : il est prioritaire lorsqu'il est configuré.",
    "Sans flux configuré, la veille publique reste active comme fallback opérationnel.",
    "Les fiches directes exposent explicitement édition FR/EN, prix et état En stock/Rupture/Précommande lorsque le fallback HTML est utilisé.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
