import type { Availability, LanguageStatus } from "./types";

const REFERENCE_PATTERNS: Array<[string, RegExp]> = [
  ["IB-07", /(?:\billustration\s*box\s*(?:(?:vol(?:ume)?\.?\s*)?)0?7\b|\bib[-\s]?0?7\b)/i],
  ["IB-08", /(?:\billustration\s*box\s*(?:(?:vol(?:ume)?\.?\s*)?)0?8\b|\bib[-\s]?0?8\b)/i],
  ["OP17", /\bop[-\s]?17\b/i],
  ["OP18", /\bop[-\s]?18\b/i]
];

const FRENCH_PATTERNS = [
  /\bfrançais\b/i,
  /\bfrancais\b/i,
  /\bversion\s+fran[çc]aise\b/i,
  /\bédition\s+fran[çc]aise\b/i,
  /\bcartes?\s+en\s+fran[çc]ais\b/i,
  /\b(?:display|booster|deck|coffret)\s+fr\b/i,
  /(?:^|[\s–—|()[\]-])fr(?:$|[\s–—|()[\]-])/i,
  /\bvf\b/i
];

const ENGLISH_PATTERNS = [
  /\benglish\b/i,
  /\banglais\b/i,
  /\bversion\s+anglaise\b/i,
  /(?:^|[\s–—|()[\]-])eng?(?:$|[\s–—|()[\]-])/i
];

const JAPANESE_PATTERNS = [
  /\bjapanese\b/i,
  /\bjaponais\b/i,
  /\bversion\s+japonaise\b/i,
  /(?:^|[\s–—|()[\]-])jp(?:$|[\s–—|()[\]-])/i
];

const OTHER_LANGUAGE_PATTERNS = [
  /\ballemand\b/i,
  /\bgerman\b/i,
  /\bespagnol\b/i,
  /\bspanish\b/i,
  /\bitalien\b/i,
  /\bitalian\b/i,
  /\bnéerlandais\b/i,
  /\bdutch\b/i
];

const UNAVAILABLE_PATTERNS = [
  /rupture(?:\s+de\s+stock)?/i,
  /épuis[ée]/i,
  /epuis[ée]/i,
  /hors\s+stock/i,
  /indisponible/i,
  /out\s+of\s+stock/i,
  /sold\s+out/i,
  /produit\s+épuisé/i,
  /not\s+available/i
];

const PREORDER_PATTERNS = [
  /précommande/i,
  /precommande/i,
  /préco\b/i,
  /preco\b/i,
  /pre[-\s]?order/i,
  /réservation/i,
  /reservation/i
];

const AVAILABLE_PATTERNS = [
  /ajouter\s+au\s+panier/i,
  /add\s+to\s+(?:cart|basket)/i,
  /en\s+stock/i,
  /disponible/i,
  /commander/i,
  /\b\d+\s+en\s+stock\b/i
];

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function matchReferences(value: string): string[] {
  return REFERENCE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

export function detectLanguage(value: string): LanguageStatus {
  if (FRENCH_PATTERNS.some((pattern) => pattern.test(value))) return "Français confirmé";
  if (ENGLISH_PATTERNS.some((pattern) => pattern.test(value))) return "Anglais détecté";
  if (JAPANESE_PATTERNS.some((pattern) => pattern.test(value))) return "Japonais détecté";
  if (OTHER_LANGUAGE_PATTERNS.some((pattern) => pattern.test(value))) return "Autre langue détectée";
  return "Langue non précisée";
}

export function detectAvailability(value: string): Availability {
  if (UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(value))) return "unavailable";
  if (PREORDER_PATTERNS.some((pattern) => pattern.test(value))) return "preorder";
  if (AVAILABLE_PATTERNS.some((pattern) => pattern.test(value))) return "available";
  return "unknown";
}

export function extractPrice(value: string): string | undefined {
  const euroAfter = value.match(/\b\d{1,4}(?:[ .]\d{3})*(?:[,.]\d{2})?\s*€/);
  if (euroAfter) return euroAfter[0].replace(/\s+/g, " ").trim();

  const euroBefore = value.match(/€\s*\d{1,4}(?:[ .]\d{3})*(?:[,.]\d{2})?/);
  return euroBefore?.[0].replace(/\s+/g, " ").trim();
}
