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
    "https://www.philibertnet.com/modules/feeder/rss.php?id_category=15860"
  ],
  productUrlPatterns: [/\/fr\/[^/]+\/\d+-[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 8,
  maxConcurrency: 1,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "Discovery officielle toutes les 15 minutes via le flux RSS public Philibert de la catégorie One Piece (15860).",
    "Le RSS sert uniquement à découvrir les fiches actives ; le Fast Watch minute relit ensuite seulement les URLs directes qualifiées mises en cache.",
    "La grosse page catégorie HTML n'est plus utilisée dans le chemin critique car elle peut répondre 403 selon la sortie Cloudflare.",
    "HTTP 403/429/5xx sur une fiche directe = source dégradée, jamais rupture ; aucun contournement anti-bot n'est utilisé."
  ]
};
