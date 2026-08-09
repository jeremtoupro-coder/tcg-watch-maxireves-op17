import type { ConnectorDefinition } from "../types";

export const oupi: ConnectorDefinition = {
  key: "oupi",
  name: "Oupi",
  sources: [
    "https://oupi.eu/fr/413-precommande-one-piece?q=Langue-Fran%C3%A7ais"
  ],
  productUrlPatterns: [/\/\d+-[^/?#]+\.html(?:[?#].*)?$/i],
  notes: [
    "PrestaShop confirmé par les routes et la structure publique.",
    "Source limitée à la catégorie Précommande One Piece filtrée Français.",
    "Le catalogue public expose titre, prix, langue et disponibilité sans rendu navigateur.",
    "Si le WAF refuse l'IP d'un hébergeur, le connecteur doit être marqué dégradé plutôt que simuler une absence de stock."
  ]
};
