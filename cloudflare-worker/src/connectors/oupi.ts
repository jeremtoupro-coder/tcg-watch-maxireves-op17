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
  maxConcurrency: 1,
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
    "Oupi est volontairement interrogé séquentiellement : un probe Cloudflare isolé a confirmé HTTP 200 sur catégorie et fiche OP17, tandis que les rafales concurrentes peuvent provoquer des 503 transitoires.",
    "Les fiches directes restent la source de vérité pour stock et langue ; seules les références actives du calendrier sont promues vers Fast Watch.",
    "Le profil HTTP OPWatch explicite est conservé ; aucun User-Agent navigateur ou contournement WAF n'est utilisé.",
    "Un 429/5xx ou une erreur réseau transitoire déclenche au maximum un second essai après 1,5 s ; un 403/challenge/CAPTCHA n’est jamais retenté ni contourné.",
    "Si les deux essais échouent, la source reste dégradée et n’est jamais interprétée comme une rupture de stock."
  ]
};
