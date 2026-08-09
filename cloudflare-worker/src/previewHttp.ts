import type { ProductCandidate } from "./types";

/** Erreurs HTTP pouvant être dues à la propagation Cloudflare ou au réseau. */
export function isTransientPreviewStatus(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

/**
 * Indique qu'une ligne est exploitable par le filtre commercial strict avant
 * le croisement avec la fenêtre du calendrier officiel.
 */
export function isCommerciallyQualifiedCandidate(
  candidate: Pick<ProductCandidate, "language" | "availability" | "commercialEligible">
): boolean {
  return candidate.commercialEligible === true &&
    candidate.language === "Français confirmé" &&
    candidate.availability !== "unknown";
}
