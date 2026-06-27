import { detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";
import type {
  ConnectorDefinition,
  ProductCandidate,
  SourceAudit,
  StoreAudit
} from "./types";

const MAX_RESPONSE_BYTES = 2_500_000;
const REQUEST_TIMEOUT_MS = 20_000;
const SOURCE_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usefulAnchorText(value: string): boolean {
  const text = stripHtml(value).toLowerCase();
  return Boolean(text) && ![
    "voir plus",
    "quick view",
    "add to cart",
    "ajouter au panier",
    "produit épuisé",
    "product sold out"
  ].includes(text);
}

function nearestHeading(htmlBeforeAnchor: string): string {
  const headings = [...htmlBeforeAnchor.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
  return headings.length ? stripHtml(headings[headings.length - 1][1]) : "";
}

function productUrlMatches(url: string, connector: ConnectorDefinition): boolean {
  return connector.productUrlPatterns.some((pattern) => pattern.test(url));
}

function extractCandidates(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): { candidates: ProductCandidate[]; productLinksSeen: number } {
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const candidates: ProductCandidate[] = [];
  const seen = new Set<string>();
  let productLinksSeen = 0;

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[2]?.trim();
    if (!rawHref) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(rawHref, sourceUrl).toString();
    } catch {
      continue;
    }

    const rawAnchorText = match[3] ?? "";
    const anchorText = stripHtml(rawAnchorText);
    const directReferences = matchReferences(`${anchorText} ${absoluteUrl}`);
    const isProductUrl = productUrlMatches(absoluteUrl, connector);

    if (isProductUrl) productLinksSeen += 1;
    if (!isProductUrl && directReferences.length === 0) continue;

    const anchorIndex = match.index ?? 0;
    const before = html.slice(Math.max(0, anchorIndex - 1_400), anchorIndex);
    const after = html.slice(anchorIndex, Math.min(html.length, anchorIndex + match[0].length + 1_200));
    const heading = nearestHeading(before);
    const title = usefulAnchorText(rawAnchorText) ? anchorText : heading;
    const context = stripHtml(`${before.slice(-900)} ${after}`);
    const searchableText = `${title} ${absoluteUrl} ${context}`;
    const matchedReferences = matchReferences(searchableText);

    if (matchedReferences.length === 0) continue;
    if (!title || title.length < 3) continue;

    const dedupeKey = `${absoluteUrl}|${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    candidates.push({
      store: connector.key,
      storeName: connector.name,
      title,
      url: absoluteUrl,
      sourceUrl,
      matchedReferences,
      availability: detectAvailability(context),
      language: detectLanguage(`${title} ${context}`),
      priceText: extractPrice(context),
      excerpt: context.slice(0, 500)
    });
  }

  return { candidates, productLinksSeen };
}

async function fetchSource(
  sourceUrl: string,
  connector: ConnectorDefinition
): Promise<SourceAudit> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only stock audit)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
      }
    });

    const body = await response.arrayBuffer();
    const responseBytes = body.byteLength;

    if (responseBytes > MAX_RESPONSE_BYTES) {
      throw new Error(`Réponse trop volumineuse: ${responseBytes} octets`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = new TextDecoder("utf-8").decode(body);
    const extracted = extractCandidates(html, response.url || sourceUrl, connector);

    return {
      sourceUrl,
      finalUrl: response.url || sourceUrl,
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      responseBytes,
      durationMs: Math.round(performance.now() - started),
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      productLinksSeen: extracted.productLinksSeen,
      candidates: extracted.candidates
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sourceUrl,
      durationMs: Math.round(performance.now() - started),
      productLinksSeen: 0,
      candidates: [],
      error: message
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function auditConnector(connector: ConnectorDefinition): Promise<StoreAudit> {
  const sources: SourceAudit[] = [];

  for (const [index, sourceUrl] of connector.sources.entries()) {
    if (index > 0) await sleep(SOURCE_DELAY_MS);
    sources.push(await fetchSource(sourceUrl, connector));
  }

  const uniqueCandidates = new Map<string, ProductCandidate>();
  for (const source of sources) {
    for (const candidate of source.candidates) {
      uniqueCandidates.set(`${candidate.url}|${candidate.title}`, candidate);
    }
  }

  return {
    store: connector.key,
    storeName: connector.name,
    checkedAt: new Date().toISOString(),
    sources,
    candidates: [...uniqueCandidates.values()],
    notes: connector.notes
  };
}
