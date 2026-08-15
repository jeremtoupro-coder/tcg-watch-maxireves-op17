import { stripHtml } from "./matching";
import {
  aliasesForProduct,
  parseOfficialCatalog,
  type OfficialProduct,
  type ProductFamily
} from "./opwatchV1";

export type ReleaseDatePrecision = "exact" | "month_assumed_first";
export type OfficialCalendarProduct = OfficialProduct & {
  releaseDatePrecision?: ReleaseDatePrecision;
};

const KNOWN_FAMILIES = new Set(["OP", "EB", "PRB", "ST", "DP", "TS"]);
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
  return KNOWN_FAMILIES.has(prefix) ? prefix as ProductFamily : "OTHER";
}

function strictIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function releaseField(value: string): string | undefined {
  const marker = value.match(/\b(?:Date de sortie|Release Date)\b/i);
  if (!marker || marker.index === undefined) return undefined;
  return value.slice(marker.index, Math.min(value.length, marker.index + 120));
}

function parseExactReleaseField(value: string): string | undefined {
  const field = releaseField(value);
  if (!field) return undefined;

  const french = field.match(
    /\b(\d{1,2})\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d{2})\b/i
  );
  if (french) {
    const month = MONTHS[french[2].toLowerCase()];
    if (month) return strictIsoDate(Number(french[3]), month, Number(french[1]));
  }

  const english = field.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i
  );
  if (english) {
    const month = MONTHS[english[1].toLowerCase()];
    if (month) return strictIsoDate(Number(english[3]), month, Number(english[2]));
  }

  return undefined;
}

function parseMonthOnlyReleaseField(value: string): string | undefined {
  const field = releaseField(value);
  if (!field) return undefined;

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

function canonicalCatalogCode(match: RegExpMatchArray): string | undefined {
  const prefix = (match[1] ?? match[3])?.toUpperCase();
  const number = match[2] ?? match[4];
  if (!prefix || !number) return undefined;
  return `${prefix}-${number.padStart(2, "0")}`;
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
 * Le parseur strict des familles connues garde la priorité.
 *
 * Si Bandai ne fournit qu'un mois de sortie, OP Watch crée une date provisoire
 * au premier de ce mois. Lorsqu'une date exacte apparaît ensuite, elle remplace
 * automatiquement cette hypothèse au prochain rafraîchissement du calendrier.
 *
 * Pour rester autonome si Bandai crée une nouvelle famille, un préfixe encore
 * inconnu est accepté uniquement sur le catalogue officiel déjà validé et
 * uniquement sous la forme bracketée [ABC-01]. Cette contrainte n'est jamais
 * appliquée aux pages marchandes : elle évite d'élargir le matching commercial
 * à des références arbitraires.
 */
export function parseOfficialCatalogWithMonthFallback(html: string): OfficialCalendarProduct[] {
  const exactProducts = parseOfficialCatalog(html).map((product) => ({
    ...product,
    releaseDatePrecision: "exact" as const
  }));
  const products = new Map<string, OfficialCalendarProduct>(exactProducts.map((product) => [product.id, product]));

  const text = stripHtml(html);

  // Bandai publie parfois un produit commun sous une référence composite,
  // par exemple [OP15-EB04], avec une seule date après le crochet. Le parseur
  // code-par-code voit alors OP15 avant EB04 et n'attribue naturellement la
  // date qu'au dernier code. Ce passage applique explicitement la même date à
  // tous les codes du groupe officiel, sans élargir le matching marchand.
  const bracketMatches = [...text.matchAll(/\[([^\]]+)\]/g)];
  for (let index = 0; index < bracketMatches.length; index += 1) {
    const bracket = bracketMatches[index];
    const codes = [...bracket[1].matchAll(/\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b/gi)]
      .map((match) => `${match[1].toUpperCase()}-${match[2].padStart(2, "0")}`);
    if (codes.length < 2) continue;

    const start = bracket.index ?? 0;
    const end = bracketMatches[index + 1]?.index ?? Math.min(text.length, start + 900);
    const segment = text.slice(start, end);
    const exactReleaseDate = parseExactReleaseField(segment);
    const releaseDate = exactReleaseDate ?? parseMonthOnlyReleaseField(segment);
    if (!releaseDate) continue;

    for (const canonical of [...new Set(codes)]) {
      const incoming: OfficialCalendarProduct = {
        id: canonical,
        family: familyFromCode(canonical),
        label: products.get(canonical)?.label ?? canonical,
        releaseDate,
        releaseDatePrecision: exactReleaseDate ? "exact" : "month_assumed_first",
        aliases: aliasesForProduct(canonical)
      };
      products.set(canonical, mergeOfficialCalendarProduct(products.get(canonical), incoming));
    }
  }

  const codePattern = /\b(OP|EB|PRB|ST|DP|TS)[-\s]?(\d{1,2})\b|\[([A-Z]{2,4})-(\d{1,2})\]/gi;
  const matches = [...text.matchAll(codePattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const canonical = canonicalCatalogCode(match);
    if (!canonical) continue;

    const matchIndex = match.index ?? 0;
    const nextIndex = matches[index + 1]?.index ?? Math.min(text.length, matchIndex + 900);
    const segment = text.slice(matchIndex, nextIndex);
    const exactReleaseDate = parseExactReleaseField(segment);
    const releaseDate = exactReleaseDate ?? parseMonthOnlyReleaseField(segment);
    if (!releaseDate) continue;

    const incoming: OfficialCalendarProduct = {
      id: canonical,
      family: familyFromCode(canonical),
      label: products.get(canonical)?.label ?? canonical,
      releaseDate,
      releaseDatePrecision: exactReleaseDate ? "exact" : "month_assumed_first",
      aliases: aliasesForProduct(canonical)
    };
    products.set(canonical, mergeOfficialCalendarProduct(products.get(canonical), incoming));
  }

  return [...products.values()].sort((left, right) => left.releaseDate.localeCompare(right.releaseDate));
}
