import type { ConnectorDefinition } from "../types";

export const ludotrotter: ConnectorDefinition = {
  key: "ludotrotter",
  name: "Ludotrotter",
  sources: [
    "https://ludotrotter.fr/categorie-produit/magasin/cartes/one-piece/"
  ],
  productUrlPatterns: [/\/produit\//i, /\/product\//i],
  notes: [
    "WooCommerce très probable d'après la structure publique.",
    "La première page est triée du plus récent au plus ancien.",
    "Le prototype ne lit que la première page pour limiter la charge."
  ]
};
