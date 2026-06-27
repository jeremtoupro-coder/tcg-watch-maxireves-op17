import type { ConnectorDefinition } from "../types";

export const fantasySphere: ConnectorDefinition = {
  key: "fantasy-sphere",
  name: "Fantasy Sphere",
  sources: [
    "https://en.fantasysphere.net/product/coffret-illustration-box-vol-7-one-piece-cg-ib-07-en-10041399",
    "https://en.fantasysphere.net/product/coffret-illustration-box-vol-8-one-piece-cg-ib-08-en-10041400",
    "https://en.fantasysphere.net/product/booster-op17-one-piece-cg-op-17-fr-10042439",
    "https://en.fantasysphere.net/product/boite-de-24-boosters-op17-one-piece-cg-op-17-fr-10042440",
    "https://en.fantasysphere.net/product/carton-de-12-boites-de-24-boosters-op17-one-piece-cg-op-17-fr-10042441",
    "https://en.fantasysphere.net/product/booster-blister-op17-one-piece-cg-op-17-fr-10042442",
    "https://en.fantasysphere.net/product/carton-de-24-boosters-blister-op17-one-piece-cg-op-17-fr-10042443",
    "https://en.fantasysphere.net/product/boite-de-24-boosters-op18-one-piece-cg-op-18-fr-10045251"
  ],
  productUrlPatterns: [/\/product\//i],
  notes: [
    "Les fiches cibles sont contrôlées directement, même avant leur apparition dans la catégorie publique."
  ]
};
