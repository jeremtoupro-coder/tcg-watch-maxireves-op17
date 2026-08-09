import type { ConnectorDefinition } from "../types";

const honestHeaders = {
  "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
};

export const ludisphere: ConnectorDefinition = {
  key: "ludisphere",
  name: "Ludisphere",
  sources: ["https://ludisphere.fr/collections/one-piece-card-game-precommande"],
  productUrlPatterns: [/\/products\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Catalogue One Piece public avec VF/EN explicites.",
    "Profil HTTP honnête utilisé : ne jamais imiter un navigateur pour contourner une protection.",
    "La fiche directe est relue avant de retenir stock, langue et prix."
  ]
};

export const parkage: ConnectorDefinition = {
  key: "parkage",
  name: "Parkage",
  sources: [
    "https://www.parkage.com/fr/one-piece-card-game?language%5B%5D=fr",
    "https://www.parkage.com/fr/pack-spciaux-one-piece-card-game",
    "https://www.parkage.com/fr/deck-one-piece-card-game"
  ],
  productUrlPatterns: [/\/fr\/\d{6,}-[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "La catégorie One Piece expose un filtre langue FR et des fiches publiques.",
    "Un 429/403 est une dégradation de source, jamais une rupture de stock."
  ]
};

export const ultrajeux: ConnectorDefinition = {
  key: "ultrajeux",
  name: "UltraJeux",
  sources: [
    "https://www.ultrajeux.com/cat.php?jeu=1031",
    "https://www.ultrajeux.com/cat.php?cat=1&jeu=1031"
  ],
  productUrlPatterns: [/\/produit-\d+-[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Le catalogue public distingue notamment produits français et anglais.",
    "Les fiches produit publiques sont relues pour éviter les collisions de texte entre cartes catalogue."
  ]
};

export const playin: ConnectorDefinition = {
  key: "playin",
  name: "Playin",
  sources: [
    "https://www.play-in.com/fr/gamme/24/one-piece/catalogue",
    "https://www.play-in.com/fr/categorie/335/booster-et-boite-one-piece"
  ],
  productUrlPatterns: [/\/fr\/produit\/\d+\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Catalogue One Piece public ; les événements/tournois ne sont pas des fiches produits et sont exclus par le pattern URL.",
    "La langue doit rester explicitement confirmée avant alerte."
  ]
};

export const philibert: ConnectorDefinition = {
  key: "philibert",
  name: "Philibert",
  sources: ["https://www.philibertnet.com/fr/17214-one-piece-le-jeu-de-cartes"],
  productUrlPatterns: [/\/fr\/[^/]+\/\d+-[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Catégorie française séparée de la catégorie anglaise/japonaise.",
    "Fiches publiques avec langue, prix, disponibilité et vendeur Philibert."
  ]
};

export const cultura: ConnectorDefinition = {
  key: "cultura",
  name: "Cultura",
  sources: ["https://www.cultura.com/cartes-a-jouer/cartes-one-piece.html"],
  productUrlPatterns: [/\/p-[^?#]+-\d+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Le catalogue mélange produits FR, JP et vendeurs partenaires : qualification langue stricte obligatoire.",
    "Les fiches Cultura exposent publiquement prix, vendeur et disponibilité."
  ]
};

export const micromania: ConnectorDefinition = {
  key: "micromania",
  name: "Micromania",
  sources: ["https://www.micromania.fr/search?q=one%20piece%20booster"],
  productUrlPatterns: [/https?:\/\/(?:www\.)?micromania\.fr\/[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 16,
  notes: [
    "Source de recherche publique à valider depuis le runtime Cloudflare.",
    "Aucune disponibilité n'est supposée lorsque la page renvoie du JS incomplet, une erreur ou aucun signal de stock fiable."
  ]
};

export const fnac: ConnectorDefinition = {
  key: "fnac",
  name: "Fnac",
  sources: ["https://www.fnac.com/One-Piece/m285486/w-4"],
  productUrlPatterns: [/\/[^?#/]+\/a\d+\/w-4/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  requiredSellerPatterns: [/\bvendu(?:e)?\s+(?:et\s+expédié(?:e)?\s+)?par\s+(?:la\s+)?fnac\b/i, /\bvendu\s+par\s+fnac\b/i],
  requiredSellerLabel: "Fnac",
  notes: [
    "Marketplace : aucune alerte commerciale depuis une carte de catégorie.",
    "Une fiche directe doit confirmer Fnac comme vendeur avant alerte."
  ]
};

export const leclerc: ConnectorDefinition = {
  key: "leclerc",
  name: "E.Leclerc",
  sources: ["https://www.e.leclerc/recherche?q=one%20piece%20booster"],
  productUrlPatterns: [/\/fp\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  requiredSellerPatterns: [/\bvendu\s+par\s+e\.?leclerc\b/i, /\bvendu\s+par\s+leclerc\b/i, /\bsnc\s+lcommerce\b/i],
  requiredSellerLabel: "E.Leclerc",
  notes: [
    "Marketplace et disponibilité locale : les offres partenaires ne doivent pas déclencher d'alerte E.Leclerc.",
    "Une fiche directe doit confirmer E.Leclerc/SNC LCOMMERCE comme vendeur."
  ]
};

export const carrefour: ConnectorDefinition = {
  key: "carrefour",
  name: "Carrefour",
  sources: ["https://www.carrefour.fr/s?q=one%20piece%20booster"],
  productUrlPatterns: [/\/p\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  requiresDirectProductPageForAlerts: true,
  requiredSellerPatterns: [/\bvendu(?:e)?\s+(?:et\s+expédié(?:e)?\s+)?par\s+carrefour\b/i, /\bvendu\s+par\s+carrefour\b/i],
  requiredSellerLabel: "Carrefour",
  notes: [
    "Marketplace et stock local : une fiche directe doit confirmer Carrefour comme vendeur.",
    "Une offre partenaire n'est jamais requalifiée en offre Carrefour."
  ]
};

export const kingJouet: ConnectorDefinition = {
  key: "king-jouet",
  name: "King Jouet",
  sources: ["https://www.king-jouet.com/jeux-jouets/one-piece/asmodee-cartes-a-collectionner/page1.htm"],
  productUrlPatterns: [/\/jeu-jouet\/[^?#]+\/ref-\d+-[^?#]+\.htm/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Catégorie One Piece / cartes à collectionner publique avec état WEB et prix.",
    "La fiche directe est relue pour confirmer l'état avant alerte."
  ]
};

export const joueclub: ConnectorDefinition = {
  key: "joueclub",
  name: "JouéClub",
  sources: ["https://www.joueclub.fr/one-piece/liste-des-produits.html"],
  productUrlPatterns: [/\/one-piece\/[^?#]+-\d+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Certaines fiches contiennent des placeholders Angular ; l'état catalogue Web/Magasin reste exploitable en découverte.",
    "Si le prix/stock direct n'est pas résolu de manière fiable, aucune donnée n'est inventée."
  ]
};

export const amazonFr: ConnectorDefinition = {
  key: "amazon-fr",
  name: "Amazon FR",
  sources: ["https://www.amazon.fr/s?k=one+piece+card+game+francais"],
  productUrlPatterns: [/\/dp\/[A-Z0-9]{8,12}/i, /\/gp\/product\/[A-Z0-9]{8,12}/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 12,
  requiresDirectProductPageForAlerts: true,
  requiredSellerPatterns: [
    /\bvendu\s+par\s+amazon\b/i,
    /\bships\s+from\s+amazon\b/i,
    /\bexpédié(?:e)?\s+par\s+amazon\b/i
  ],
  requiredSellerLabel: "Amazon",
  notes: [
    "Source à haut risque anti-bot/marketplace : un challenge ou 403/429 dégrade la source et ne produit aucun stock.",
    "Alerte commerciale uniquement si la fiche directe confirme Amazon comme vendeur/expéditeur selon les signaux publics."
  ]
};

export const mysticAmbre: ConnectorDefinition = {
  key: "mystic-ambre",
  name: "Mystic-Ambre",
  sources: [
    "https://www.mystic-ambre.fr/boutique/pre-commande/one-piece-pre-co/",
    "https://www.mystic-ambre.fr/boutique/pre-commande/one-piece-pre-co/display-one-piece-fr/"
  ],
  productUrlPatterns: [/\/boutique\/[^?#]+\.html/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Précommandes One Piece publiques avec FR/EN explicites.",
    "La catégorie FR dédiée est utilisée sans assouplir le filtre de langue global."
  ]
};

export const ludiworld: ConnectorDefinition = {
  key: "ludiworld",
  name: "Ludiworld",
  sources: [
    "https://www.ludiworld.com/",
    "https://www.ludiworld.com/search?q=one%20piece"
  ],
  productUrlPatterns: [/\/products\/[^?#]+/i, /\/product\/[^?#]+/i, /\/produit\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 16,
  notes: [
    "Le robots.txt bloquant certains crawlers externes ne préjuge pas du comportement du runtime Cloudflare.",
    "Le statut doit être déterminé uniquement par les probes HTTP réels du Worker."
  ]
};

export const vegastore: ConnectorDefinition = {
  key: "vegastore",
  name: "VegaStore",
  sources: [
    "https://www.vegastore.fr/collections/one-piece",
    "https://www.vegastore.fr/products/display-one-piece-op-17-boite-de-24-boosters-francais"
  ],
  productUrlPatterns: [/\/products\/[^?#]+/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 20,
  notes: [
    "Storefront Shopify public avec fiches One Piece FR explicites.",
    "La fiche OP17 FR connue sert de témoin direct en plus de la collection."
  ]
};

export const otakuland: ConnectorDefinition = {
  key: "otakuland",
  name: "Otakuland",
  sources: [
    "https://otakuland.fr/",
    "https://otakuland.fr/?s=one+piece&post_type=product"
  ],
  productUrlPatterns: [/https?:\/\/(?:www\.)?otakuland\.fr\/(?!cart|checkout|my-account)[^?#]+\/?$/i],
  requestHeaders: honestHeaders,
  followDiscoveredProductPages: true,
  maxDiscoveredProductPages: 12,
  notes: [
    "Le catalogue public observé est actuellement orienté merchandising/figurines, pas TCG.",
    "La source reste incluse pour détecter une future apparition de produits TCG ; aucun produit n'est inventé si le catalogue reste hors cible."
  ]
};

export const ROLLOUT_CONNECTORS: ConnectorDefinition[] = [
  ludisphere,
  parkage,
  ultrajeux,
  playin,
  philibert,
  cultura,
  micromania,
  fnac,
  leclerc,
  carrefour,
  kingJouet,
  joueclub,
  amazonFr,
  mysticAmbre,
  ludiworld,
  vegastore,
  otakuland
];
