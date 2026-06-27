import type { ConnectorDefinition } from "../types";

export const oupi: ConnectorDefinition = {
  key: "oupi",
  name: "Oupi",
  sources: [
    "https://oupi.eu/en/382-one-piece"
  ],
  productUrlPatterns: [/\/\d+-[^/?#]+\.html(?:[?#].*)?$/i],
  notes: [
    "PrestaShop très probable d'après les routes et la structure publique.",
    "La catégorie expose prix et ajout au panier sans JavaScript.",
    "La réponse est volumineuse : une source de recherche plus légère reste à identifier."
  ]
};
