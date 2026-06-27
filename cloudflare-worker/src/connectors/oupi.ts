import type { ConnectorDefinition } from "../types";

export const oupi: ConnectorDefinition = {
  key: "oupi",
  name: "Oupi",
  sources: [
    "https://oupi.eu/en/413-pre-order-one-piece"
  ],
  productUrlPatterns: [/\/\d+-[^/?#]+\.html(?:[?#].*)?$/i],
  notes: [
    "PrestaShop très probable d'après les routes et la structure publique.",
    "La page Précommandes One Piece contient 17 produits au lieu des 189 de la catégorie générale.",
    "Elle expose les fiches OP17, leur prix, leur langue et leur statut sans JavaScript."
  ]
};
