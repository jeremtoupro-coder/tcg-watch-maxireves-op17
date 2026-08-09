import type { ConnectorDefinition } from "../types";

const PROBE_SOURCES: Record<string, string[]> = {
  ludisphere: [
    "https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250"
  ],
  playin: [
    "https://www.play-in.com/fr/gamme/24/one-piece/catalogue",
    "https://www.play-in.com/fr/categorie/335/booster-et-boite-one-piece",
    "https://www.play-in.com/fr/produit/646300/display-de-24-boosters-op-16-l-heure-de-la-bataille-decisive-one-piece-fr"
  ],
  cultura: [
    "https://www.cultura.com/c/carte-one-piece",
    "https://www.cultura.com/cartes-a-jouer/cartes-one-piece.html",
    "https://www.cultura.com/p-booster-one-piece-op16-l-heure-de-la-bataille-decisive-13080126.html"
  ],
  micromania: [
    "https://www.micromania.fr/on/demandware.store/Sites-Micromania-Site/fr_FR/Search-Show?q=one%20piece%20booster",
    "https://www.micromania.fr/on/demandware.store/Sites-Micromania-Site/fr_FR/Search-Show?q=one%20piece%20op15",
    "https://www.micromania.fr/cartes-one-piece-op13.html"
  ],
  fnac: [
    "https://www.fnac.com/One-Piece/m285486/w-4",
    "https://www.fnac.com/SearchResult/ResultList.aspx?Search=one%20piece%20op16&sft=1&sa=0",
    "https://www.fnac.com/Cartes-a-collectionner-One-Piece-OP16-Booster-Blister/a23123796/w-4"
  ],
  carrefour: [
    "https://www.carrefour.fr/s?q=one%20piece%20booster",
    "https://www.carrefour.fr/p/cartes-booster-one-piece-op14-les-sept-de-la-mer-d-azur-bandai-4582769923166"
  ],
  "king-jouet": [
    "https://api.king-jouet.com/",
    "https://api.king-jouet.com/api/catalogue/articles/1034198/data",
    "https://www.king-jouet.com/jeu-jouet/jeux-societes/cartes-a-collectionner/ref-1034198-cartes-one-piece-booster-op16-heure-de-la-bataille-decisive.htm"
  ],
  otakuland: [
    "https://otakuland.fr/one-piece-merch/",
    "https://otakuland.fr/wp-json/wc/store/v1/products?search=one%20piece&per_page=20",
    "https://otakuland.fr/otakuland/"
  ]
};

export function applyEightStoreProbeOverrides(connector: ConnectorDefinition): ConnectorDefinition {
  const sources = PROBE_SOURCES[connector.key];
  if (!sources) return connector;

  return {
    ...connector,
    sources,
    followDiscoveredProductPages: false,
    notes: [
      ...connector.notes,
      "AUDIT TEMPORAIRE : plusieurs routes publiques alternatives sont testées depuis le runtime Cloudflare ; aucune n'est activée en LIVE par ce fichier."
    ]
  };
}
