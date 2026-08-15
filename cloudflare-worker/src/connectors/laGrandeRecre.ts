import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const laGrandeRecre: ConnectorDefinition = {
  key: "la-grande-recre",
  name: "La Grande Récré",
  sources: [
    "https://www.lagranderecre.fr/cartes-a-collectionner/"
  ],
  productUrlPatterns: [
    /\/jeux-de-societe\/cartes-a-collectionner\/[^?#]*one-piece[^?#]*\.html/i
  ],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  authorizedFeedEnv: "AUTHORIZED_FEED_LA_GRANDE_RECRE_URL",
  notes: [
    "La catégorie publique Cartes à collectionner expose des produits One Piece avec prix et disponibilité livraison.",
    "Flux produit Affilae/Lengow autorisé disponible : Discovery prioritaire, puis fiches directes qualifiées en Fast Watch.",
    "Sans flux configuré, la veille publique reste active comme fallback opérationnel.",
    "Le motif d'URL limite la Discovery aux fiches One Piece afin de ne pas relire inutilement les autres TCG de la catégorie.",
    "Les fiches directes restent la source de vérité lorsque le fallback HTML est utilisé.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
