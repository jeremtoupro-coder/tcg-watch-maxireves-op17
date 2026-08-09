import { decodeHtml, normalizeForMatching, stripHtml } from "./matching";

export type ProductFormat = "booster" | "display" | "case" | "double_pack" | "starter" | "other";
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
  december: 11
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
  /(?:^|[\s([\-|])eng?(?:$|[\s)\]|-])/i,
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

function isoDateUtc(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString().slice(0, 10);
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

/**
 * Parse la page publique PRODUCTS officielle. Le parseur n'associe jamais une
 * date globale au hasard : une date doit se trouver dans une petite fenêtre
 * autour du code produit. Les doublons sont fusionnés par identifiant.
 */
export function parseOfficialCatalog(html: string): OfficialProduct[] {
  const text = stripHtml(html);
  const codePattern = /\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b/gi;
  const products = new Map<string, OfficialProduct>();

  for (const match of text.matchAll(codePattern)) {
    const index = match.index ?? 0;
    const canonical = canonicalProductCode(match[0]);
    if (!canonical) continue;

    const before = text.slice(Math.max(0, index - 260), index);
    const after = text.slice(index, Math.min(text.length, index + 500));
    const local = `${before} ${match[0]} ${after}`;
    const releaseDate = parseEnglishDate(local);
    if (!releaseDate) continue;

    const labelStart = Math.max(0, before.lastIndexOf("  "));
    const rawLabel = `${before.slice(labelStart)} ${match[0]}`.replace(/\s+/g, " ").trim();
    const label = rawLabel.length >= 4 && rawLabel.length <= 180 ? rawLabel : canonical;

    const existing = products.get(canonical);
    if (!existing || existing.releaseDate > releaseDate) {
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
  const release = new Date(`${releaseDate}T12:00:00.000Z`);
  if (Number.isNaN(release.getTime())) throw new Error(`Date de sortie invalide: ${releaseDate}`);

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

export function listingIdentity(store: string, productId: string, format: ProductFormat): string {
  return `${store.trim().toLowerCase()}|${productId}|${format}|fr`;
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
