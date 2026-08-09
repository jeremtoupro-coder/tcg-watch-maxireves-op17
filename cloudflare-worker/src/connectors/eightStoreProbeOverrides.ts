import type { ConnectorDefinition } from "../types";

const PROBE_SOURCES: Record<string, string[]> = {
  ludisphere: [
    "https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250"
  ],
  playin: [
    "https://r.jina.ai/https://www.play-in.com/fr/produit/646300/display-de-24-boosters-op-16-l-heure-de-la-bataille-decisive-one-piece-fr"
  ],
  cultura: [
    "https://r.jina.ai/https://www.cultura.com/p-booster-one-piece-op16-l-heure-de-la-bataille-decisive-13080126.html"
  ],
  micromania: [
    "https://r.jina.ai/https://www.micromania.fr/cartes-one-piece-op13.html"
  ],
  fnac: [
    "https://r.jina.ai/https://www.fnac.com/Cartes-a-collectionner-One-Piece-OP16-Booster-Blister/a23123796/w-4"
  ],
  carrefour: [
    "https://r.jina.ai/https://www.carrefour.fr/p/cartes-booster-one-piece-op14-les-sept-de-la-mer-d-azur-bandai-4582769923166"
  ],
  "king-jouet": [
    "https://r.jina.ai/https://www.king-jouet.com/jeu-jouet/jeux-societes/cartes-a-collectionner/ref-1034198-cartes-one-piece-booster-op16-heure-de-la-bataille-decisive.htm"
  ],
  otakuland: [
    "https://otakuland.fr/one-piece-merch/",
    "https://otakuland.fr/wp-json/wc/store/v1/products?search=one%20piece&per_page=20"
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
      "AUDIT TEMPORAIRE : fallback Reader public testé sans contournement actif des protections ; aucune route n'est activée en LIVE avant validation métier."
    ]
  };
}
