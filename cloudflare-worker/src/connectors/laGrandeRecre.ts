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
  notes: [
    "La catégorie publique Cartes à collectionner expose des produits One Piece avec prix et disponibilité livraison.",
    "Le motif d'URL limite la Discovery aux fiches One Piece afin de ne pas relire inutilement les autres TCG de la catégorie.",
    "Les fiches directes restent la source de vérité pour la référence, la langue et la disponibilité avant alerte.",
    "Candidature Affilae en attente : un flux partenaire pourra être privilégié s'il devient disponible.",
    "HTTP 403/429/5xx = source dégradée, jamais rupture."
  ]
};
