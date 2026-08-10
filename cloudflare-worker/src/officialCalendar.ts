import { stripHtml } from "./matching";
import {
  parseOfficialCatalog,
  type OfficialProduct
} from "./opwatchV1";
import { computeOfficialWatchWindow, type OfficialWatchWindow } from "./officialWatchPolicy";
import type { StateStore } from "./state";

const CACHE_KEY = "official-calendar:fr:v1";
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_FETCH_ATTEMPTS = 2;
const TRANSIENT_RETRY_DELAY_MS = 750;

export interface OfficialCalendarSnapshot {
  source: string;
  fetchedAt: string;
  sourcePages: number;
  catalogProducts: OfficialProduct[];
  activeProducts: Array<OfficialProduct & {
    watchWindow: OfficialWatchWindow;
  }>;
  cache: "hit" | "miss";
}

interface CalendarOptions {
  sourceUrl: string;
  now?: Date;
  /** Compatibilité de configuration V1 : la borne de début n'est plus utilisée. */
  daysBefore: number;
  /** Compatibilité de configuration V1 : la fin réelle est désormais +1 mois calendaire. */
  daysAfter: number;
  stateStore?: StateStore;
  fetcher?: typeof fetch;
}

interface CachedCalendar {
  source: string;
  fetchedAt: string;
  sourcePages: number;
  catalogProducts: OfficialProduct[];
}

function challengeReason(html: string): string | undefined {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const prefix = stripHtml(html.slice(0, 50_000)).slice(0, 2_000);
  if (/just a moment|performing security verification/i.test(`${title} ${prefix}`)) {
    return "challenge Cloudflare";
  }
  if (/robot check|verify (?:you are|that you are) human|captcha/i.test(`${title} ${prefix}`)) {
    return "challenge humain/CAPTCHA";
  }
  return undefined;
}

export function parseOfficialCatalogPageCount(html: string): number {
  const text = stripHtml(html);
  const match = text.match(/\b\d+\s*\/\s*(\d{1,2})\b/);
  if (!match) return 1;
  const pages = Number(match[1]);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
    throw new Error(`Pagination officielle invalide: ${match[1]}`);
  }
  return pages;
}

export function validateOfficialCatalogPage(html: string): void {
  const challenge = challengeReason(html);
  if (challenge) throw new Error(`Source calendrier invalide: ${challenge}`);

  const text = stripHtml(html);
  if (!/ONE PIECE CARD GAME/i.test(text) || !/\bPRODUITS?\b|\bPRODUCTS?\b/i.test(text)) {
    throw new Error("Source calendrier invalide: marqueurs officiels absents");
  }
  if (!/\b(OP|EB|PRB|ST|DP|TS)[-\s]?\d{1,2}\b/i.test(text)) {
    throw new Error("Source calendrier invalide: aucune référence produit reconnue");
  }
}

function buildSnapshot(
  cached: CachedCalendar,
  now: Date,
  cache: "hit" | "miss"
): OfficialCalendarSnapshot {
  const activeProducts = cached.catalogProducts.flatMap((product) => {
    const watchWindow = computeOfficialWatchWindow(product.releaseDate, now);
    return watchWindow.active ? [{ ...product, watchWindow }] : [];
  });
  return {
    ...cached,
    activeProducts,
    cache
  };
}

function parseCachedCalendar(raw?: string): CachedCalendar | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedCalendar>;
    if (
      typeof parsed.source !== "string" ||
      typeof parsed.fetchedAt !== "string" ||
      !Number.isInteger(parsed.sourcePages) ||
      !Array.isArray(parsed.catalogProducts) ||
      parsed.catalogProducts.length === 0
    ) {
      return undefined;
    }
    return parsed as CachedCalendar;
  } catch {
    return undefined;
  }
}

function isTransientCalendarError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError") return true;
  return /Calendrier officiel HTTP (?:408|425|429|5\d\d)\b/.test(error.message) ||
    /operation was aborted|network|fetch failed|connection reset|timed out/i.test(error.message);
}

async function fetchPageOnce(fetcher: typeof fetch, url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch/1.0 (+read-only official French release calendar)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`Calendrier officiel HTTP ${response.status}`);
    const finalUrl = new URL(response.url || url);
    if (finalUrl.hostname !== "fr.onepiece-cardgame.com") {
      throw new Error(`Redirection calendrier inattendue vers ${finalUrl.hostname}`);
    }
    const html = await response.text();
    validateOfficialCatalogPage(html);
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPage(fetcher: typeof fetch, url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchPageOnce(fetcher, url);
    } catch (error) {
      lastError = error;
      if (!isTransientCalendarError(error) || attempt === MAX_FETCH_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function loadOfficialCalendar(options: CalendarOptions): Promise<OfficialCalendarSnapshot> {
  const now = options.now ?? new Date();
  const source = new URL(options.sourceUrl);
  if (source.protocol !== "https:" || source.hostname !== "fr.onepiece-cardgame.com") {
    throw new Error("La source calendrier doit être le site officiel français en HTTPS.");
  }

  const cached = parseCachedCalendar(await options.stateStore?.getMetadata(CACHE_KEY));
  if (cached) {
    const cachedAt = Date.parse(cached.fetchedAt);
    if (Number.isFinite(cachedAt) && now.getTime() - cachedAt < CACHE_MAX_AGE_MS) {
      return buildSnapshot(cached, now, "hit");
    }
  }

  const fetcher = options.fetcher ?? fetch;
  const firstHtml = await fetchPage(fetcher, source.toString());
  const sourcePages = parseOfficialCatalogPageCount(firstHtml);
  const htmlPages = [firstHtml];

  for (let page = 2; page <= sourcePages; page += 3) {
    const batch: Promise<string>[] = [];
    for (let offset = 0; offset < 3 && page + offset <= sourcePages; offset += 1) {
      const pageUrl = new URL(source);
      pageUrl.searchParams.set("page", String(page + offset));
      batch.push(fetchPage(fetcher, pageUrl.toString()));
    }
    htmlPages.push(...await Promise.all(batch));
  }

  const productsById = new Map<string, OfficialProduct>();
  for (const html of htmlPages) {
    for (const product of parseOfficialCatalog(html)) {
      const existing = productsById.get(product.id);
      if (existing && existing.releaseDate !== product.releaseDate) {
        throw new Error(
          `Dates officielles contradictoires pour ${product.id}: ` +
          `${existing.releaseDate} / ${product.releaseDate}`
        );
      }
      if (!existing) {
        productsById.set(product.id, product);
      }
    }
  }
  const catalogProducts = [...productsById.values()]
    .sort((left, right) => left.releaseDate.localeCompare(right.releaseDate));
  if (catalogProducts.length === 0) {
    throw new Error("Le catalogue officiel est valide mais aucun produit daté n'a été reconnu.");
  }

  const fresh: CachedCalendar = {
    source: source.toString(),
    fetchedAt: now.toISOString(),
    sourcePages,
    catalogProducts
  };
  if (options.stateStore?.writable) {
    await options.stateStore.putMetadata(CACHE_KEY, JSON.stringify(fresh));
  }
  return buildSnapshot(fresh, now, "miss");
}
