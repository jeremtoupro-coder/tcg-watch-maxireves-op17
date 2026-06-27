import type { ConnectorDefinition } from "../types";

export const fantasySphere: ConnectorDefinition = {
  key: "fantasy-sphere",
  name: "Fantasy Sphere",
  sources: [
    "https://en.fantasysphere.net/jeux-de-cartes-a-collectionner/one-piece-tcg/"
  ],
  productUrlPatterns: [/\/product\//i],
  notes: [
    "La catégorie publique expose titres, prix et disponibilité sans navigateur lourd.",
    "Le sitemap produit révèle IB-07, IB-08, OP17 et OP18 même lorsque les fiches sont masquées.",
    "Le sitemap fait près de 10 Mo : découverte exhaustive via GitHub Actions, contrôles légers via Cloudflare."
  ]
};
