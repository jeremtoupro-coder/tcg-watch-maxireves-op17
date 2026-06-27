import type { ConnectorDefinition } from "../types";

export const maxireves: ConnectorDefinition = {
  key: "maxireves",
  name: "Maxi Rêves",
  sources: [
    "https://maxireves.fr/selection-jeux/jeux-de-cartes-tcg/one-piece-tcg/",
    "https://maxireves.fr/selection-jeux/nouveautes-et-precommandes/"
  ],
  productUrlPatterns: [/\/produit\//i, /\/product\//i],
  notes: [
    "WordPress/WooCommerce confirmé par la structure publique.",
    "La catégorie One Piece expose nom, prix et quantité sans JavaScript.",
    "Deux pages seulement sont lues pendant l'audit manuel."
  ]
};
