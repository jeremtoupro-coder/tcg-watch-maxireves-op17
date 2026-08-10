import type { ConnectorDefinition } from "../types";

export const oupi: ConnectorDefinition = {
  key: "oupi",
  name: "Oupi",
  sources: [
    "https://oupi.eu/fr/413-precommande-one-piece",
    "https://oupi.eu/fr/382-one-piece"
  ],
  productUrlPatterns: [/\/\d+-[^/?#]+\.html(?:[?#].*)?$/i],
  responseMustContainAny: [/one[\s-]*piece/i],
  maxConcurrency: 2,
  requestHeaders: {
    "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
  },
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 10,
  requiresDirectProductPageForAlerts: true,
  notes: [
    "PrestaShop confirmé par les routes et la structure publique.",
    "Discovery allégée : la catégorie précommandes capte les nouveautés et la catégorie One Piece globale sert de filet de sécurité, au lieu de charger cinq catégories redondantes.",
    "Les fiches directes restent la source de vérité pour stock et langue ; seules les références actives du calendrier sont promues vers Fast Watch.",
    "Le profil HTTP OPWatch explicite est conservé ; aucun User-Agent navigateur ou contournement WAF n'est utilisé.",
    "Un HTTP 403/429/5xx doit dégrader la source et ne doit jamais être interprété comme une rupture de stock."
  ]
};
