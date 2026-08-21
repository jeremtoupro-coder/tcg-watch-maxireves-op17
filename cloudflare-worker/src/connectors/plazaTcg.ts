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
    "https://plazatcg.com/display/2189-one-piece-display-les-guerriers-les-plus-puissants-au-monde-op17-francais-4582770058710.html",
    "https://plazatcg.com/5-one-piece",
    "https://plazatcg.com/"
  ],
  productUrlPatterns: [
    /\/[a-z0-9-]+\/\d+-[^?#]+\.html(?:$|[?#])/i
  ],
  requestHeaders: honestHeaders,
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: true,
  // Fenêtre OP17 critique : les trois sources ci-dessus doivent rester dans le
  // Fast Watch minute afin de détecter aussi une éventuelle nouvelle URL.
  // Ce flag fait repasser les sources configurées à chaque cycle ; le parsing
  // reste celui des pages HTML publiques et aucune protection n'est contournée.
  authoritativeStructuredFeed: true,
  maxDiscoveredProductPages: 4,
  maxConcurrency: 2,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "OP17 critique : fiche actuelle + catégorie One Piece + accueil relus au Fast Watch minute pour couvrir un changement d'URL au lancement.",
    "Les liens OP17 nouvellement découverts sont suivis dans le même cycle puis la fiche directe valide langue, prix et disponibilité avant Discord.",
    "Le libellé Précommandes seul ne vaut pas ouverture : INDISPONIBLE/Rupture reste fail-closed jusqu'à un vrai état disponible ou précommande sur la fiche directe."
  ]
};
