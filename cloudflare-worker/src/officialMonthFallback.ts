import { stripHtml } from "./matching";
import {
  aliasesForProduct,
  canonicalProductCode,
  parseOfficialCatalog,
  type OfficialProduct,
  type ProductFamily
} from "./opwatchV1";

export type ReleaseDatePrecision = "exact" | "month_assumed_first";
export type OfficialCalendarProduct = OfficialProduct & {
  releaseDatePrecision?: ReleaseDatePrecision;
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12
};

function familyFromCode(code: string): ProductFamily {
  const prefix = code.split("-")[0];
  return ["OP", "EB", "PRB", "ST", "DP", "TS"].includes(prefix)
    ? prefix as ProductFamily
    : "OTHER";
}

function parseMonthOnlyReleaseField(value: string): string | undefined {
  const marker = value.match(/\b(?:Date de sortie|Release Date)\b/i);
  if (!marker || marker.index === undefined) return undefined;
  const field = value.slice(marker.index, Math.min(value.length, marker.index + 120));

  // Une date exacte doit rester prioritaire. Le fallback ne s'applique que si
  // Bandai ne communique réellement qu'un mois + une année.
  if (/\b\d{1,2}\s+(?:janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+20\d{2}\b/i.test(field) ||
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i.test(field)) {
    return undefined;
  }

  const monthYear = field.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d{2})\b/i
  );
  if (!monthYear) return undefined;
  const month = MONTHS[monthYear[1].toLowerCase()];
  if (!month) return undefined;
  return `${monthYear[2]}-${String(month).padStart(2, "0")}-01`;
}

export function mergeOfficialCalendarProduct(
  existing: OfficialCalendarProduct | undefined,
  incoming: OfficialCalendarProduct
): OfficialCalendarProduct {
  if (!existing) return incoming;

  const existingPrecision = existing.releaseDatePrecision ?? "exact";
  const incomingPrecision = incoming.releaseDatePrecision ?? "exact";

  if (existing.releaseDate === incoming.releaseDate) {
    return existingPrecision === "exact" ? existing : incoming;
  }
  if (existingPrecision === "month_assumed_first" && incomingPrecision === "exact") return incoming;
  if (existingPrecision === "exact" && incomingPrecision === "month_assumed_first") return existing;

  throw new Error(
    `Dates officielles contradictoires pour ${incoming.id}: ` +
    `${existing.releaseDate} / ${incoming.releaseDate}`
  );
}

/**
 * Le parseur strict garde la priorité. Si Bandai ne fournit qu'un mois de
 * sortie, OP Watch crée une date provisoire au premier de ce mois. Lorsqu'une
 * date exacte apparaît ensuite, elle remplace automatiquement cette hypothèse
 * au prochain rafraîchissement du calendrier.
 */
export function parseOfficialCatalogWithMonthFallback(html: string): OfficialCalendarProduct[] {
  const exactProducts = parseOfficialCatalog(html).map((product) => ({
    ...product,
    releaseDatePrecision: "exact" as const
  }));
  const products = new Map<string, OfficialCalendarProduct>(exactProducts.map((product) => [product.id, product]));

  const text = stripHtml(html);
  const codePattern = /\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b/gi;
  const matches = [...text.matchAll(codePattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const canonical = canonicalProductCode(match[0]);
    if (!canonical || products.get(canonical)?.releaseDatePrecision === "exact") continue;

    const matchIndex = match.index ?? 0;
    const nextIndex = matches[index + 1]?.index ?? Math.min(text.length, matchIndex + 900);
    const segment = text.slice(matchIndex, nextIndex);
    const releaseDate = parseMonthOnlyReleaseField(segment);
    if (!releaseDate) continue;

    const incoming: OfficialCalendarProduct = {
      id: canonical,
      family: familyFromCode(canonical),
      label: canonical,
      releaseDate,
      releaseDatePrecision: "month_assumed_first",
      aliases: aliasesForProduct(canonical)
    };
    products.set(canonical, mergeOfficialCalendarProduct(products.get(canonical), incoming));
  }

  return [...products.values()].sort((left, right) => left.releaseDate.localeCompare(right.releaseDate));
}
