import type { ConnectorDefinition } from "../types";

export const parkage: ConnectorDefinition = {
  key: "parkage",
  name: "Parkage",
  sources: ["https://www.parkage.com/fr/one-piece-card-game?language%5B%5D=fr"],
  productUrlPatterns: [/\/fr\/\d{6,}-[^?#]+/i],
  requestHeaders: {
    "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
    "Accept": "application/json,text/html;q=0.8,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9"
  },
  responseMustContainAny: [/one[\s-]*piece/i],
  followDiscoveredProductPages: false,
  notes: [
    "Catalogue FR lu via l'API publique utilisée par le frontend Parkage ; aucune URL produit anglaise n'est seedée.",
    "Le Fast Watch conserve le fail-closed : seules les lignes API lang=fr avec référence One Piece reconnue deviennent candidates."
  ]
};
