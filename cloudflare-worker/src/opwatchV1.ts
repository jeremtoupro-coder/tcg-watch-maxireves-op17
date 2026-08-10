import { decodeHtml, normalizeForMatching, stripHtml } from "./matching";
import type { LanguageStatus, ProductCandidate, ProductFormat, WatchConfig } from "./types";

export type { ProductFormat } from "./types";
export type ProductFamily = "OP" | "EB" | "PRB" | "ST" | "DP" | "TS" | "OTHER";
export type ListingLanguage = "fr_confirmed" | "non_fr" | "unknown";

export interface OfficialProduct {
  id: string;
  family: ProductFamily;
  label: string;
  releaseDate: string;
  aliases: string[];
}

export interface WatchWindow {
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export interface QualifiedListing {
  productId?: string;
  format: ProductFormat;
  language: ListingLanguage;
  languageConfidence: number;
  actionable: boolean;
  reasons: string[];
  imageUrl?: string;
  identityKey?: string;
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  janvier: 0,
  fevrier: 1,
  février: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  août: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  décembre: 11
};

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
  /\bcarte\s+[àa]\s+l['’]unit[eé]\b/i
];

const NON_FR_PATTERNS = [
  /\bjapanese\b/i,
  /\bjaponais\b/i,
  /\bversion\s+japonaise\b/i,
  /(?:^|[\s([\-|])jp(?:$|[\s)\]|-])/i,
  /\benglish\b/i,
  /\banglais\b/i,
  /\bversion\s+anglaise\b/i,
  /(?:^|[\s([\-|])eng(?:$|[\s)\]|-])/i,
  /(?:^|[\s([\-|])EN(?:$|[\s)\]|-])/,
  /\basia\b/i
];

const FR_PATTERNS = [
  /\bfran[çc]ais\b/i,
  /\bversion\s+fran[çc]aise\b/i,
  /\b[eé]dition\s+fran[çc]aise\b/i,
  /\bcartes?\s+en\s+fran[çc]ais\b/i,
  /(?:^|[\s([\-|])fr(?:$|[\s)\]|-])/i,
  /\bvf\b/i
];

function isoDateUtc(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function parseEnglishDate(value: string): string | undefined {
  const match = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i
  );
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return undefined;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31) return undefined;
  return isoDateUtc(year, month, day);
}

function parseFrenchDate(value: string): string | undefined {
  const match = value.match(
    /\b(\d{1,2})\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d{2})\b/i
  );
  if (!match) return undefined;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return undefined;
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (day < 1 || day > 31) return undefined;
  return isoDateUtc(year, month, day);
}

function parseOfficialDate(value: string): string | undefined {
  return parseEnglishDate(value) ?? parseFrenchDate(value);
}

function parseFirstReleaseDateField(value: string): string | undefined {
  const markers = [...value.matchAll(/\b(?:Date de sortie|Release Date)\b/gi)];
  const first = markers[0];
  if (!first) return undefined;
  const start = first.index ?? 0;
  const next = markers[1]?.index ?? value.length;
  // Une date exacte doit appartenir au premier champ de sortie placé après
  // la référence. Si ce champ ne contient qu'un mois (ex. « Octobre 2026 »),
  // on ne cherche jamais une date dans la carte produit/accessoire suivante.
  return parseOfficialDate(value.slice(start, Math.min(next, start + 120)));
}

function familyFromCode(code: string): ProductFamily {
  const prefix = code.split("-")[0];
  if (["OP", "EB", "PRB", "ST", "DP", "TS"].includes(prefix)) return prefix as ProductFamily;
  return "OTHER";
}

export function canonicalProductCode(raw: string): string | undefined {
  const match = raw.toUpperCase().match(/\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

export function aliasesForProduct(code: string): string[] {
  const canonical = canonicalProductCode(code) ?? code.toUpperCase();
  const match = canonical.match(/^([A-Z]+)-(\d{2})$/);
  if (!match) return [canonical];
  return [canonical, `${match[1]}${match[2]}`, `${match[1]} ${match[2]}`];
}

function officialProductLabel(text: string, codeIndex: number, canonical: string): string {
  const family = familyFromCode(canonical);
  const patterns: Partial<Record<ProductFamily, RegExp>> = {
    OP: /\bBOOSTER\b/gi,
    EB: /\bEXTRA\s+BOOSTER\b/gi,
    PRB: /\bPREMIUM\s+BOOSTER\b/gi,
    ST: /\b(?:DECK\s+POUR\s+D[ÉE]BUTANT|STARTER\s+DECK)\b/gi,
    DP: /\bDOUBLE\s+PACK\b/gi
  };
  const pattern = patterns[family];
  if (!pattern) return canonical;

  const context = text.slice(Math.max(0, codeIndex - 240), codeIndex);
  const starts = [...context.matchAll(pattern)];
  const start = starts.at(-1)?.index;
  if (start === undefined) return canonical;

  const title = context
    .slice(start)
    .replace(/\[\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length < 4 || title.length > 180 || /\b(?:Date de sortie|Release Date)\b/i.test(title)) {
    return canonical;
  }
  return `${title} [${canonical}]`;
}

/**
 * Parse la page publique PRODUCTS officielle.
 *
 * Règle de sûreté : une date n'est jamais cherchée avant la référence produit.
 * On limite d'abord l'analyse au bloc compris entre cette référence et la
 * référence suivante. Cela évite d'attribuer à un produit la date du produit
 * précédent. Si aucune date n'est trouvée dans ce bloc, le produit n'est pas
 * activé automatiquement : mieux vaut une absence temporaire qu'une mauvaise
 * fenêtre de surveillance.
 */
export function parseOfficialCatalog(html: string): OfficialProduct[] {
  const text = stripHtml(html);
  const codePattern = /\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b/gi;
  const matches = [...text.matchAll(codePattern)];
  const products = new Map<string, OfficialProduct>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const matchIndex = match.index ?? 0;
    const canonical = canonicalProductCode(match[0]);
    if (!canonical) continue;

    const nextIndex = matches[index + 1]?.index;
    const segmentEnd = nextIndex ?? Math.min(text.length, matchIndex + 900);
    const segment = text.slice(matchIndex, segmentEnd);
    const releaseDate = parseFirstReleaseDateField(segment);
    if (!releaseDate) continue;

    const label = officialProductLabel(text, matchIndex, canonical);

    const existing = products.get(canonical);
    if (existing && existing.releaseDate !== releaseDate) {
      throw new Error(
        `Dates officielles contradictoires pour ${canonical}: ` +
        `${existing.releaseDate} / ${releaseDate}`
      );
    }
    if (!existing) {
      products.set(canonical, {
        id: canonical,
        family: familyFromCode(canonical),
        label,
        releaseDate,
        aliases: aliasesForProduct(canonical)
      });
    }
  }

  return [...products.values()].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
}

export function computeWatchWindow(
  releaseDate: string,
  now = new Date(),
  daysBefore = 120,
  daysAfter = 30
): WatchWindow {
  const match = releaseDate.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const strictDate = match
    ? isoDateUtc(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : undefined;
  if (strictDate !== releaseDate) throw new Error(`Date de sortie invalide: ${releaseDate}`);
  const release = new Date(`${strictDate}T12:00:00.000Z`);

  const starts = new Date(release.getTime() - daysBefore * 86_400_000);
  const ends = new Date(release.getTime() + daysAfter * 86_400_000);
  return {
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    active: now.getTime() >= starts.getTime() && now.getTime() <= ends.getTime()
  };
}

export function activeOfficialProducts(
  products: OfficialProduct[],
  now = new Date(),
  daysBefore = 120,
  daysAfter = 30
): OfficialProduct[] {
  return products.filter((product) => computeWatchWindow(product.releaseDate, now, daysBefore, daysAfter).active);
}

export function detectProductFormat(value: string): ProductFormat {
  const text = decodeHtml(value);
  if (/\b(double\s*pack|doublepack|double\s+pack\s+set|DP[-\s]?\d{1,2})\b/i.test(text)) return "double_pack";
  if (/\b(starter\s*deck|deck\s+de\s+d[eé]marrage|ST[-\s]?\d{1,2})\b/i.test(text)) return "starter";
  if (/\b(case|master\s+case|carton)(?:\s+scell[eé])?\b/i.test(text)) return "case";
  if (/\b(display|booster\s*box|bo[iî]te\s+(?:de\s+)?\d+\s+boosters?)\b/i.test(text)) return "display";
  if (/\bbooster(?:\s+[àa]\s+l['’]unit[eé])?\b/i.test(text)) return "booster";
  return "other";
}

export function detectFrenchListing(value: string): { language: ListingLanguage; confidence: number } {
  if (NON_FR_PATTERNS.some((pattern) => pattern.test(value))) {
    return { language: "non_fr", confidence: 100 };
  }
  if (FR_PATTERNS.some((pattern) => pattern.test(value))) {
    return { language: "fr_confirmed", confidence: 100 };
  }
  return { language: "unknown", confidence: 45 };
}

export function extractProductImage(html: string, baseUrl: string): string | undefined {
  const candidates: string[] = [];
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og?.[1]) candidates.push(decodeHtml(og[1]));

  for (const jsonImage of html.matchAll(/["']image["']\s*:\s*(?:\[\s*)?["']([^"']+)["']/gi)) {
    if (jsonImage[1]) candidates.push(decodeHtml(jsonImage[1]));
  }

  const img = html.match(/<img\b[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
  if (img?.[1]) candidates.push(decodeHtml(img[1]));

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      if (/logo|icon|sprite|payment/i.test(url.pathname)) continue;
      return url.toString();
    } catch {
      // Ignore une image mal formée et essaie la suivante.
    }
  }
  return undefined;
}

function findMatchedProductId(value: string, activeProducts: OfficialProduct[]): string | undefined {
  const normalized = normalizeForMatching(value);
  const matches = activeProducts.filter((product) =>
    product.aliases.some((alias) => normalized.includes(normalizeForMatching(alias)))
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

function normalizedIdentityDiscriminator(value: string): string {
  return normalizeForMatching(value)
    .replace(/(?:op|eb|prb|st|dp|ts)\d{1,2}/g, "")
    .replace(/(?:francais|french|versionfr|vf)/g, "")
    .slice(0, 120);
}

function identityLanguageKey(language: LanguageStatus): string {
  if (language === "Anglais détecté") return "en";
  if (language === "Japonais détecté") return "jp";
  if (language === "Français confirmé") return "fr";
  return "other";
}

export function listingIdentity(
  store: string,
  productId: string,
  format: ProductFormat,
  discriminator = "",
  language: LanguageStatus = "Français confirmé"
): string {
  const stablePart = normalizedIdentityDiscriminator(discriminator);
  return `${store.trim().toLowerCase()}|${productId}|${format}|${identityLanguageKey(language)}${stablePart ? `|${stablePart}` : ""}`;
}

export function enrichCandidateIdentity(candidate: ProductCandidate): ProductCandidate {
  const canonicalReferences = [...new Set(candidate.matchedReferences
    .map((reference) => canonicalProductCode(reference) ?? reference.toUpperCase()))]
    .sort();
  const format = candidate.format ?? detectProductFormat(`${candidate.title} ${candidate.url} ${candidate.excerpt}`);
  const reference = canonicalReferences.length === 1 ? canonicalReferences[0] : undefined;
  const discriminator = candidate.externalId || candidate.title;

  return {
    ...candidate,
    matchedReferences: canonicalReferences,
    format,
    identityKey: reference && format !== "other"
      ? listingIdentity(candidate.store, reference, format, discriminator, candidate.language)
      : candidate.identityKey
  };
}

export function candidateForActiveProducts(
  candidate: ProductCandidate,
  activeProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[] = ["Français confirmé"]
): ProductCandidate | undefined {
  const enriched = enrichCandidateIdentity(candidate);
  const activeIds = new Set(activeProducts.map((product) => product.id));
  const activeReferences = enriched.matchedReferences.filter((reference) => activeIds.has(reference));

  if (activeReferences.length !== 1) return undefined;
  const matchedProduct = activeProducts.find((product) => product.id === activeReferences[0]);
  if (!enriched.format) return undefined;
  if (enriched.format === "other" && matchedProduct?.family !== "OTHER") return undefined;
  if (!acceptedLanguages.includes(enriched.language)) return undefined;
  if (enriched.availability === "unknown") return undefined;
  if (enriched.commercialEligible === false) return undefined;
  if (ACCESSORY_PATTERNS.some((pattern) => pattern.test(`${enriched.title} ${enriched.excerpt}`))) return undefined;

  return {
    ...enriched,
    matchedReferences: activeReferences,
    identityKey: listingIdentity(
      enriched.store,
      activeReferences[0],
      enriched.format,
      enriched.externalId || enriched.title,
      enriched.language
    )
  };
}

export function buildActiveWatchConfig(products: OfficialProduct[], acceptedLanguages: LanguageStatus[] = ["Français confirmé"]): WatchConfig {
  if (products.length === 0) {
    throw new Error("Impossible de construire la surveillance sans produit officiel actif.");
  }

  const productIds = products.map((product) => product.id);
  return {
    version: 3,
    settings: {
      notifyOnInitialDiscovery: false,
      defaultLanguages: acceptedLanguages
    },
    products: products.map((product) => ({
      id: product.id,
      label: product.label,
      game: "one-piece",
      enabled: true,
      aliases: product.aliases,
      searchTerms: product.aliases
    })),
    alerts: [
      {
        id: "active-products-availability-fr",
        label: "Disponibilité des produits officiels actifs FR",
        enabled: true,
        productIds,
        stores: ["*"],
        languages: acceptedLanguages,
        events: ["new_listing", "back_in_stock", "preorder_opened", "became_unavailable"],
        availabilities: ["available", "preorder", "unavailable"],
        notifyOnInitialDiscovery: false
      },
      {
        id: "active-products-price-fr",
        label: "Variation de prix des produits officiels actifs FR",
        enabled: true,
        productIds,
        stores: ["*"],
        languages: acceptedLanguages,
        events: ["price_drop", "price_increase"],
        availabilities: ["*"],
        notifyOnInitialDiscovery: false
      }
    ]
  };
}

export function qualifyListing(input: {
  store: string;
  title: string;
  url: string;
  pageText?: string;
  html?: string;
  activeProducts: OfficialProduct[];
  minimumLanguageConfidence?: number;
}): QualifiedListing {
  const combined = `${input.title} ${input.url} ${input.pageText ?? ""}`;
  const reasons: string[] = [];
  const productId = findMatchedProductId(combined, input.activeProducts);
  const format = detectProductFormat(combined);
  const language = detectFrenchListing(combined);
  const minimum = input.minimumLanguageConfidence ?? 90;

  if (!productId) reasons.push("Référence produit active non confirmée ou ambiguë.");
  if (format === "other") reasons.push("Format non ciblé ou non déterminé.");
  if (ACCESSORY_PATTERNS.some((pattern) => pattern.test(combined))) reasons.push("Accessoire/carte unitaire rejeté.");
  if (language.language !== "fr_confirmed" || language.confidence < minimum) {
    reasons.push(language.language === "non_fr" ? "Langue non française détectée." : "Français non confirmé.");
  }

  const actionable = reasons.length === 0;
  return {
    productId,
    format,
    language: language.language,
    languageConfidence: language.confidence,
    actionable,
    reasons,
    imageUrl: input.html ? extractProductImage(input.html, input.url) : undefined,
    identityKey: productId && format !== "other" ? listingIdentity(input.store, productId, format) : undefined
  };
}
