import {
  candidateLanguageConfidence,
  canonicalProductCode,
  enrichCandidateIdentity,
  listingIdentity
} from "./opwatchV1";
import type {
  LanguageStatus,
  ProductCandidate,
  WatchConfig
} from "./types";

const ONE_PIECE_TCG_FAMILIES = new Set(["OP", "EB", "PRB", "ST", "DP", "TS"]);

const ACCESSORY_PATTERNS = [
  /\bsleeves?\b/i,
  /\bprot[eè]ge[- ]?cartes?\b/i,
  /\bdeck\s*box\b/i,
  /\bplaymat\b/i,
  /\btapis\b/i,
  /\bbinder\b/i,
  /\bportfolio\b/i,
  /\bfigurine\b/i,
  /\bsingle\s+card\b/i,
  /\bcarte\s+[àa]\s+l['’]unit[eé]\b/i,
  /\bcarte\s+unit[eé]\b/i
];

export type AllCandidateRejectionReason =
  | "reference_one_piece_absente_ou_ambigue"
  | "langue_non_acceptee"
  | "confiance_langue_insuffisante"
  | "disponibilite_inconnue"
  | "accessoire_ou_carte_unitaire";

export interface AllCandidateQualification {
  candidate?: ProductCandidate;
  reasons: AllCandidateRejectionReason[];
}

function canonicalAllReference(reference: string): string | undefined {
  const canonical = canonicalProductCode(reference);
  if (!canonical) return undefined;
  return ONE_PIECE_TCG_FAMILIES.has(canonical.split("-")[0]) ? canonical : undefined;
}

/**
 * Qualification du circuit ONE PIECE ALL.
 *
 * Contrairement au circuit Nouvelles sorties, aucune fenêtre de calendrier
 * n'est appliquée : une ancienne référence reste mémorisée afin de détecter un
 * véritable retour en stock. Un candidat provenant d'une carte de catégorie
 * peut donc alimenter l'état même s'il n'est pas encore éligible à une alerte ;
 * alerts.ts exige ensuite explicitement l'éligibilité commerciale, ce qui
 * conserve la validation de fiche directe avant Discord.
 */
export function qualifyCandidateForAllOnePiece(
  candidate: ProductCandidate,
  acceptedLanguages: LanguageStatus[] = ["Français confirmé"],
  minimumLanguageConfidence = 90
): AllCandidateQualification {
  const enriched = enrichCandidateIdentity(candidate);
  const references = [...new Set(enriched.matchedReferences.flatMap((reference) => {
    const canonical = canonicalAllReference(reference);
    return canonical ? [canonical] : [];
  }))];

  const reasons: AllCandidateRejectionReason[] = [];
  if (references.length !== 1) reasons.push("reference_one_piece_absente_ou_ambigue");
  if (!acceptedLanguages.includes(enriched.language)) reasons.push("langue_non_acceptee");
  if (candidateLanguageConfidence(enriched) < minimumLanguageConfidence) reasons.push("confiance_langue_insuffisante");
  if (enriched.availability === "unknown") reasons.push("disponibilite_inconnue");
  if (ACCESSORY_PATTERNS.some((pattern) => pattern.test(`${enriched.title} ${enriched.excerpt}`))) {
    reasons.push("accessoire_ou_carte_unitaire");
  }
  if (reasons.length > 0 || references.length !== 1) return { reasons };

  const reference = references[0];
  const format = enriched.format ?? "other";
  return {
    reasons,
    candidate: {
      ...enriched,
      languageConfidence: candidateLanguageConfidence(enriched),
      matchedReferences: [reference],
      format,
      identityKey: listingIdentity(
        enriched.store,
        reference,
        format,
        enriched.externalId || enriched.title,
        enriched.language
      )
    }
  };
}

export function candidateForAllOnePiece(
  candidate: ProductCandidate,
  acceptedLanguages: LanguageStatus[] = ["Français confirmé"],
  minimumLanguageConfidence = 90
): ProductCandidate | undefined {
  return qualifyCandidateForAllOnePiece(
    candidate,
    acceptedLanguages,
    minimumLanguageConfidence
  ).candidate;
}

/**
 * Construit les règles ONE PIECE ALL à partir de tout ce qui est réellement
 * observé sur les catalogues marchands. Les références encore actives dans le
 * calendrier Nouvelles sorties sont volontairement exclues de la règle
 * d'alerte, mais restent présentes dans l'état ALL : elles basculeront plus
 * tard sans faux "nouveau produit".
 */
export function buildAllOnePieceWatchConfig(
  candidates: ProductCandidate[],
  activeProductIds: Iterable<string>,
  acceptedLanguages: LanguageStatus[] = ["Français confirmé"]
): WatchConfig {
  const activeIds = new Set([...activeProductIds].map((id) => canonicalProductCode(id) ?? id.toUpperCase()));
  const allIds = [...new Set(candidates.flatMap((candidate) => candidate.matchedReferences
    .flatMap((reference) => {
      const canonical = canonicalAllReference(reference);
      return canonical ? [canonical] : [];
    })))].sort();
  const historicalIds = allIds.filter((id) => !activeIds.has(id));

  return {
    version: 1,
    settings: {
      notifyOnInitialDiscovery: false,
      defaultLanguages: acceptedLanguages
    },
    products: allIds.map((id) => ({
      id,
      label: `${id} — One Piece ALL`,
      game: "one-piece",
      enabled: true,
      aliases: [id],
      searchTerms: [id]
    })),
    alerts: [{
      id: "one-piece-all-restock",
      label: "Restocks du catalogue historique One Piece TCG",
      scope: "one_piece_all",
      enabled: true,
      productIds: historicalIds,
      stores: ["*"],
      languages: acceptedLanguages,
      events: ["new_listing", "back_in_stock"],
      availabilities: ["available"],
      notifyOnInitialDiscovery: false
    }]
  };
}
