import { decodeHtml, detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";
import { enrichCandidateIdentity, extractProductImage } from "./opwatchV1";
import { canonicalProductUrl } from "./connectorUrls";
import type {
  ConnectorDefinition,
  LanguageStatus,
  ProductCandidate,
  SourceAudit,
  StoreAudit
} from "./types";

const MAX_RESPONSE_BYTES = 2_500_000;
const REQUEST_TIMEOUT_MS = 20_000;
const SOURCE_DELAY_MS = 300;
const MAX_CONNECTOR_CONCURRENCY = 8;
const DEFAULT_MAX_DISCOVERED_PRODUCT_PAGES = 12;

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

function isCommerceActionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["add-to-cart", "add_to_cart", "remove_item", "wc-ajax", "quantity"]
      .some((param) => parsed.searchParams.has(param));
  } catch {
    return false;
  }
}

function challengePageReason(html: string): string | undefined {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const visiblePrefix = stripHtml(html.slice(0, Math.min(html.length, 50_000))).slice(0, 2_000);

  if (/^just a moment(?:\.\.\.)?$/i.test(title) || /^just a moment\b/i.test(visiblePrefix) || /title:\s*just a moment/i.test(visiblePrefix) || /performing security verification|page maybe requiring captcha/i.test(visiblePrefix)) {
    return "Cloudflare challenge page";
  }
  if (/\brobot check\b/i.test(title) || /\/errors\/validateCaptcha|sorry, we just need to make sure you(?:'|’)re not a robot/i.test(html)) {
    return "Amazon robot/CAPTCHA page";
  }
  if (/\bverify (?:you are|that you are) human\b|\baccess denied\b/i.test(`${title} ${visiblePrefix}`)) {
    return "Human verification / access denied page";
  }
  if (/si vous êtes un humain|vérifions ensemble que vous n[’']êtes pas un robot|enable javascript and cookies to continue/i.test(visiblePrefix)) {
    return "French human verification page";
  }
  if (/\bERR_[A-Z_]+\b|error-code-color|The Chromium Authors/i.test(visiblePrefix)) {
    return "Chromium network error page";
  }
  if (/geo\.captcha-delivery\.com|captcha-delivery\.com\/captcha/i.test(html) && html.length < 100_000) {
    return "DataDome CAPTCHA page";
  }
  if (/challenge-platform\/h\/g|cf-chl-(?:widget|opt|out|rc)|cdn-cgi\/challenge-platform/i.test(html) && html.length < 100_000) {
    return "Cloudflare challenge markup";
  }
  return undefined;
}

function validateSemanticResponse(html: string, connector: ConnectorDefinition): void {
  const challenge = challengePageReason(html);
  if (challenge) throw new Error(`Challenge/anti-bot: ${challenge}`);

  if (connector.responseMustContainAny?.length) {
    const text = stripHtml(html);
    if (!connector.responseMustContainAny.some((pattern) => pattern.test(text))) {
      throw new Error("HTTP 200 mais contenu métier attendu absent");
    }
  }
}

function commercialEligibility(
  connector: ConnectorDefinition,
  isDirectProductPage: boolean,
  productText: string
): { eligible: boolean; reason?: string } {
  if (connector.commercialAlertsEnabled === false) {
    return { eligible: false, reason: "Connecteur en audit uniquement : alertes commerciales désactivées." };
  }
  if (connector.requiresDirectProductPageForAlerts && !isDirectProductPage) {
    return { eligible: false, reason: "Fiche produit directe requise avant toute alerte commerciale." };
  }
  if (connector.requiredSellerPatterns?.length) {
    const sellerStarts = [...productText.matchAll(
      /\bvendu(?:e)?(?:\s+et\s+(?:exp[eé]di[eé]|livr[eé])(?:e)?)?\s+par\b/gi
    )]
      .map((match) => match.index ?? 0);
    const sellerStatements = sellerStarts.map((start, index) =>
      productText.slice(start, Math.min(sellerStarts[index + 1] ?? productText.length, start + 180))
    );
    const sellerConfirmed = sellerStatements.length > 0 && sellerStatements.every((statement) =>
      connector.requiredSellerPatterns?.some((pattern) => pattern.test(statement))
    );
    if (!sellerConfirmed) {
      return {
        eligible: false,
        reason: `${connector.requiredSellerLabel ?? "Vendeur attendu"} non confirmé sur la fiche directe.`
      };
    }
  }
  return { eligible: true };
}

function candidateScore(candidate: ProductCandidate): number {
  let score = Math.min(candidate.title.length, 200);
  if (candidate.priceText) score += 200;
  if (candidate.imageUrl) score += 100;
  if (candidate.language !== "Langue non précisée") score += 400;
  if (candidate.availability !== "unknown") score += 800;
  if (candidate.commercialEligible === true) score += 50;
  if (candidate.sourceUrl === candidate.url) score += 10_000;
  return score;
}

function languageFromPrimary(primary: string, fallback: string): LanguageStatus {
  const primaryLanguage = detectLanguage(primary);
  return primaryLanguage === "Langue non précisée" ? detectLanguage(fallback) : primaryLanguage;
}

function extractStructuredProductLanguage(productText: string): LanguageStatus | undefined {
  const field = productText.match(
    /\b(?:langue|language)(?:\(s\)|s)?\s*:?[\s-]*(français|francais|french|anglais|english|japonais|japanese|allemand|german|espagnol|spanish|italien|italian|néerlandais|dutch)\b/i
  );
  if (!field?.[1]) return undefined;
  const detected = detectLanguage(field[1]);
  return detected === "Langue non précisée" ? undefined : detected;
}

function directProductCoreText(html: string, productStart: number): string {
  const text = stripHtml(html.slice(productStart, Math.min(html.length, productStart + 100_000)));
  const relatedProductsIndex = text.search(/\b\d+\s+autres?\s+produits?\b/i);
  return (relatedProductsIndex >= 0 ? text.slice(0, relatedProductsIndex) : text.slice(0, 16_000)).trim();
}

function extractDirectProductCandidate(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): ProductCandidate | undefined {
  const productUrl = canonicalProductUrl(sourceUrl, connector);
  if (!productUrlMatches(productUrl, connector)) return undefined;

  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtml(h1Match?.[1] ?? titleMatch?.[1] ?? "");
  const matchedReferences = matchReferences(`${title} ${productUrl} ${sourceUrl}`);
  if (!title || matchedReferences.length === 0) return undefined;

  const productStart = h1Match?.index ?? titleMatch?.index ?? 0;
  const productText = directProductCoreText(html, productStart);
  const availability = detectAvailability(productText);
  const structuredLanguage = extractStructuredProductLanguage(productText);
  const language = structuredLanguage ?? languageFromPrimary(`${title} ${productUrl}`, productText);
  const eligibility = commercialEligibility(connector, true, `${title} ${productText}`);

  return enrichCandidateIdentity({
    store: connector.key,
    storeName: connector.name,
    title,
    url: productUrl,
    sourceUrl: productUrl,
    matchedReferences,
    availability,
    language,
    // Un produit indisponible peut encore afficher un prix de référence. Le
    // supprimer ici empêchait de suivre correctement ses variations avant le
    // retour en stock (notamment UltraJeux, VegaStore et Mystic-Ambre).
    priceText: extractPrice(productText),
    imageUrl: extractProductImage(html, sourceUrl),
    commercialEligible: eligibility.eligible,
    commercialEligibilityReason: eligibility.reason,
    excerpt: productText.slice(0, 500)
  });
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
    // Une fiche directe contient souvent un carrousel de produits liés. Ils ne
    // doivent jamais contaminer le stock, la langue ou la référence de la
    // fiche actuellement contrôlée.
    return { candidates: [directCandidate], productLinksSeen: 1 };
  }

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = decodeHtml(match[2] ?? "").trim();
    if (!rawHref || /^(?:#|javascript:|mailto:|tel:)/i.test(rawHref)) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(rawHref, sourceUrl).toString();
    } catch {
      continue;
    }

    if (isCommerceActionUrl(resolvedUrl)) continue;
    const absoluteUrl = canonicalProductUrl(resolvedUrl, connector);
    if (!productUrlMatches(absoluteUrl, connector)) continue;
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

    let matchedReferences = matchReferences(`${metadata} ${absoluteUrl} ${resolvedUrl}`);
    if (matchedReferences.length === 0 && !metadata) {
      matchedReferences = matchReferences(`${heading} ${absoluteUrl}`);
    }
    if (matchedReferences.length === 0 || !title || title.length < 3) continue;

    const contextHtml = `${before.slice(-1_500)} ${after}`;
    const context = stripHtml(contextHtml);
    const eligibility = commercialEligibility(connector, false, `${title} ${context}`);
    const candidate: ProductCandidate = enrichCandidateIdentity({
      store: connector.key,
      storeName: connector.name,
      title,
      url: absoluteUrl,
      sourceUrl,
      matchedReferences,
      availability: detectAvailability(context),
      language: languageFromPrimary(`${title} ${absoluteUrl}`, context),
      priceText: extractPrice(context),
      imageUrl: extractProductImage(`${rawAnchorText} ${contextHtml}`, sourceUrl),
      commercialEligible: eligibility.eligible,
      commercialEligibilityReason: eligibility.reason,
      excerpt: context.slice(0, 500)
    });

    const existing = candidatesByUrl.get(absoluteUrl);
    if (!existing || candidateScore(candidate) > candidateScore(existing)) {
      candidatesByUrl.set(absoluteUrl, candidate);
    }
  }

  return { candidates: [...candidatesByUrl.values()], productLinksSeen: productUrlsSeen.size };
}

function normalizeLudisphereShopifyJson(raw: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Ludisphere Shopify JSON invalide"); }
  const products = (parsed as { products?: unknown }).products;
  if (!Array.isArray(products)) throw new Error("Ludisphere Shopify JSON sans tableau products");
  const escapeHtml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;");
  const cards = products.map((item) => {
    const product = item as { title?: unknown; handle?: unknown; variants?: Array<{ price?: unknown; available?: unknown }>; images?: Array<{ src?: unknown }> };
    const title = typeof product.title === "string" ? product.title.trim() : "";
    const handle = typeof product.handle === "string" ? product.handle.trim() : "";
    if (!title || !handle) return "";
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const available = variants.some((variant) => variant.available === true);
    const prices = variants.map((variant) => typeof variant.price === "string" || typeof variant.price === "number" ? Number(variant.price) : Number.NaN).filter((price) => Number.isFinite(price)).sort((a, b) => a - b);
    const price = prices.length ? prices[0].toFixed(2).replace(".", ",") + " €" : "";
    const image = Array.isArray(product.images) && typeof product.images[0]?.src === "string" ? product.images[0].src : "";
    const url = "https://ludisphere.fr/products/" + encodeURIComponent(handle);
    const stock = available ? "En stock Disponible Ajouter au panier" : "Rupture de stock Produit épuisé";
    return "<article><h2><a href=\"" + escapeHtml(url) + "\">" + escapeHtml(title) + "</a></h2>" + (image ? "<img src=\"" + escapeHtml(image) + "\" alt=\"" + escapeHtml(title) + "\">" : "") + "<p>One Piece Card Game Français FR " + stock + " " + escapeHtml(price) + "</p></article>";
  }).join("");
  return "<!doctype html><html lang=\"fr\"><head><title>Ludisphere One Piece Shopify feed</title></head><body><h1>One Piece Card Game Ludisphere</h1>" + cards + "</body></html>";
}

function buildRequestHeaders(connector: ConnectorDefinition): Record<string, string> {
  return {
    "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only stock audit)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
    ...(connector.requestHeaders ?? {})
  };
}

async function fetchSource(sourceUrl: string, connector: ConnectorDefinition): Promise<SourceAudit> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status: number | undefined;
  let finalUrl: string | undefined;
  let contentType: string | undefined;
  let responseBytes: number | undefined;

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: buildRequestHeaders(connector)
    });
    status = response.status;
    finalUrl = response.url || sourceUrl;
    contentType = response.headers.get("content-type") ?? undefined;
    const body = await response.arrayBuffer();
    responseBytes = body.byteLength;
    if (responseBytes > MAX_RESPONSE_BYTES) throw new Error(`Réponse trop volumineuse: ${responseBytes} octets`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let html = new TextDecoder("utf-8").decode(body);
    if (connector.key === "ludisphere" && /application\/json/i.test(contentType ?? "")) { html = normalizeLudisphereShopifyJson(html); }
    validateSemanticResponse(html, connector);
    const extracted = extractCandidates(html, response.url || sourceUrl, connector);
    return {
      sourceUrl,
      finalUrl,
      status,
      contentType,
      responseBytes,
      durationMs: Math.round(performance.now() - started),
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      productLinksSeen: extracted.productLinksSeen,
      candidates: extracted.candidates
    };
  } catch (error) {
    return {
      sourceUrl,
      finalUrl,
      status,
      contentType,
      responseBytes,
      durationMs: Math.round(performance.now() - started),
      productLinksSeen: 0,
      candidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function allowedDiscoveryHosts(connector: ConnectorDefinition): Set<string> {
  const hosts = new Set<string>();
  for (const source of connector.sources) {
    try { hosts.add(new URL(source).host); } catch { /* source invalide gérée au fetch */ }
  }
  return hosts;
}

function discoveredProductUrls(sources: SourceAudit[], connector: ConnectorDefinition): string[] {
  const hosts = allowedDiscoveryHosts(connector);
  const configuredSources = new Set(connector.sources.map((source) => canonicalProductUrl(source, connector)));
  const discovered = new Set<string>();

  for (const source of sources) {
    for (const candidate of source.candidates) {
      if (candidate.sourceUrl === candidate.url || configuredSources.has(candidate.url)) continue;
      try {
        if (!hosts.has(new URL(candidate.url).host)) continue;
      } catch { continue; }
      discovered.add(candidate.url);
    }
  }

  const limit = Math.max(0, Math.min(50, connector.maxDiscoveredProductPages ?? DEFAULT_MAX_DISCOVERED_PRODUCT_PAGES));
  return [...discovered].slice(0, limit);
}

async function fetchSourcesInBatches(
  sourceUrls: string[],
  connector: ConnectorDefinition,
  concurrency: number
): Promise<SourceAudit[]> {
  const sources: SourceAudit[] = [];
  for (let index = 0; index < sourceUrls.length; index += concurrency) {
    if (index > 0) await sleep(SOURCE_DELAY_MS);
    const batch = sourceUrls.slice(index, index + concurrency);
    sources.push(...await Promise.all(batch.map((sourceUrl) => fetchSource(sourceUrl, connector))));
  }
  return sources;
}

export async function auditConnector(connector: ConnectorDefinition): Promise<StoreAudit> {
  const concurrency = Math.max(1, Math.min(MAX_CONNECTOR_CONCURRENCY, connector.maxConcurrency ?? 1));
  const initialSources = [...new Set(connector.sources.map((source) => canonicalProductUrl(source, connector)))];
  const sources = await fetchSourcesInBatches(initialSources, connector, concurrency);

  if (connector.followDiscoveredProductPages) {
    const productUrls = discoveredProductUrls(sources, connector);
    if (productUrls.length > 0) {
      sources.push(...await fetchSourcesInBatches(productUrls, connector, concurrency));
    }
  }

  const uniqueCandidates = new Map<string, ProductCandidate>();
  for (const source of sources) {
    for (const candidate of source.candidates) {
      const existing = uniqueCandidates.get(candidate.url);
      if (!existing || candidateScore(candidate) > candidateScore(existing)) uniqueCandidates.set(candidate.url, candidate);
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
