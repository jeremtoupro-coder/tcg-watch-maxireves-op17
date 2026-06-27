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
    "Une fiche OP17 publique existe mais n'apparaît pas actuellement dans la catégorie.",
    "Le mode de découverte des fiches masquées reste donc à fiabiliser."
  ]
};
