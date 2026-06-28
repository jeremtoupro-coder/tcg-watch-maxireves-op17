import { decodeHtml, detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";
import type {
  ConnectorDefinition,
  ProductCandidate,
  SourceAudit,
  StoreAudit
} from "./types";

const MAX_RESPONSE_BYTES = 2_500_000;
const REQUEST_TIMEOUT_MS = 20_000;
const SOURCE_DELAY_MS = 300;
const MAX_CONNECTOR_CONCURRENCY = 8;

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

function extractAttribute(tag: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = tag.match(pattern);
  return match ? stripHtml(match[2]) : "";
}

function productUrlMatches(url: string, connector: ConnectorDefinition): boolean {
  return connector.productUrlPatterns.some((pattern) => pattern.test(url));
}

function candidateScore(candidate: ProductCandidate): number {
  let score = Math.min(candidate.title.length, 200);
  if (candidate.priceText) score += 200;
  if (candidate.language !== "Langue non précisée") score += 400;
  if (candidate.availability !== "unknown") score += 800;

  // Une fiche produit directe est la source de vérité pour le stock.
  // Sans ce bonus, une carte issue d'une catégorie peut l'emporter simplement
  // parce qu'elle contient un prix, même si la fiche directe indique une rupture.
  if (candidate.sourceUrl === candidate.url) score += 10_000;

  return score;
}

function extractDirectProductCandidate(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): ProductCandidate | undefined {
  if (!productUrlMatches(sourceUrl, connector)) return undefined;

  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtml(h1Match?.[1] ?? titleMatch?.[1] ?? "");
  const matchedReferences = matchReferences(`${title} ${sourceUrl}`);

  if (!title || matchedReferences.length === 0) return undefined;

  const productStart = h1Match?.index ?? titleMatch?.index ?? 0;
  const productArea = html.slice(productStart, Math.min(html.length, productStart + 7_000));
  const context = stripHtml(productArea);
  const availability = detectAvailability(context);

  return {
    store: connector.key,
    storeName: connector.name,
    title,
    url: sourceUrl,
    sourceUrl,
    matchedReferences,
    availability,
    language: detectLanguage(`${title} ${sourceUrl} ${context}`),
    priceText: availability === "unavailable" ? undefined : extractPrice(context),
    excerpt: context.slice(0, 500)
  };
}

function extractCandidates(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): { candidates: ProductCandidate[]; productLinksSeen: number } {
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const candidatesByUrl = new Map<string, ProductCandidate>();
  const productUrlsSeen = new Set<string>();

  const directCandidate = extractDirectProductCandidate(html, sourceUrl, connector);
  if (directCandidate) {
    candidatesByUrl.set(directCandidate.url, directCandidate);
    productUrlsSeen.add(directCandidate.url);
  }

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = decodeHtml(match[2] ?? "").trim();
    if (!rawHref || /^(?:#|javascript:|mailto:|tel:)/i.test(rawHref)) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(rawHref, sourceUrl).toString();
    } catch {
      continue;
    }

    if (!productUrlMatches(absoluteUrl, connector)) continue;
    if (directCandidate && absoluteUrl === directCandidate.url) continue;
    productUrlsSeen.add(absoluteUrl);

    const fullAnchor = match[0] ?? "";
    const openingTag = fullAnchor.match(/^<a\b[^>]*>/i)?.[0] ?? "";
    const rawAnchorText = match[3] ?? "";
    const anchorText = stripHtml(rawAnchorText);
    const titleAttribute = extractAttribute(openingTag, "title");
    const ariaLabel = extractAttribute(openingTag, "aria-label");
    const imageAlt = extractAttribute(rawAnchorText.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt");

    const metadataParts = [anchorText, titleAttribute, ariaLabel, imageAlt]
      .filter((value) => usefulAnchorText(value));
    const metadata = metadataParts.join(" ");

    const anchorIndex = match.index ?? 0;
    const before = html.slice(Math.max(0, anchorIndex - 2_000), anchorIndex);
    const after = html.slice(anchorIndex, Math.min(html.length, anchorIndex + fullAnchor.length + 1_800));
    const heading = nearestHeading(before);
    const title = metadataParts.sort((a, b) => b.length - a.length)[0] || heading;

    let matchedReferences = matchReferences(`${metadata} ${absoluteUrl}`);
    if (matchedReferences.length === 0 && !metadata) {
      matchedReferences = matchReferences(`${heading} ${absoluteUrl}`);
    }

    if (matchedReferences.length === 0 || !title || title.length < 3) continue;

    const context = stripHtml(`${before.slice(-1_500)} ${after}`);
    const candidate: ProductCandidate = {
      store: connector.key,
      storeName: connector.name,
      title,
      url: absoluteUrl,
      sourceUrl,
      matchedReferences,
      availability: detectAvailability(context),
      language: detectLanguage(`${title} ${absoluteUrl} ${context}`),
      priceText: extractPrice(context),
      excerpt: context.slice(0, 500)
    };

    const existing = candidatesByUrl.get(absoluteUrl);
    if (!existing || candidateScore(candidate) > candidateScore(existing)) {
      candidatesByUrl.set(absoluteUrl, candidate);
    }
  }

  return {
    candidates: [...candidatesByUrl.values()],
    productLinksSeen: productUrlsSeen.size
  };
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
  const requestedConcurrency = (connector as ConnectorDefinition & { maxConcurrency?: number }).maxConcurrency ?? 1;
  const concurrency = Math.max(1, Math.min(MAX_CONNECTOR_CONCURRENCY, requestedConcurrency));

  for (let index = 0; index < connector.sources.length; index += concurrency) {
    if (index > 0) await sleep(SOURCE_DELAY_MS);
    const batch = connector.sources.slice(index, index + concurrency);
    sources.push(...await Promise.all(batch.map((sourceUrl) => fetchSource(sourceUrl, connector))));
  }

  const uniqueCandidates = new Map<string, ProductCandidate>();
  for (const source of sources) {
    for (const candidate of source.candidates) {
      const existing = uniqueCandidates.get(candidate.url);
      if (!existing || candidateScore(candidate) > candidateScore(existing)) {
        uniqueCandidates.set(candidate.url, candidate);
      }
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
