import { getEnabledProducts } from "./config";
import type { StoreDefinition } from "./storeConfig";

function extractLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

function normalize(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the raw value when decoding fails.
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesReference(url: string): boolean {
  const normalizedUrl = normalize(url);
  return getEnabledProducts().some((product) =>
    [product.id, ...product.aliases].some((alias) => {
      const normalizedAlias = normalize(alias);
      return normalizedAlias.length > 0 && normalizedUrl.includes(normalizedAlias);
    })
  );
}

export function sitemapProductUrls(xml: string, store: StoreDefinition): string[] {
  const patterns = store.productUrlPatterns.map((pattern) => new RegExp(pattern, "i"));
  return extractLocations(xml).filter((location) =>
    patterns.some((pattern) => pattern.test(location)) && matchesReference(location)
  );
}

export function nestedSitemapUrls(xml: string): string[] {
  return extractLocations(xml).filter((location) => /sitemap|\.xml(?:$|\?)/i.test(location));
}

async function fetchSitemap(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TCGWatch/2.0 (+personal read-only monitoring)",
        "Accept": "application/xml,text/xml,text/plain,*/*"
      }
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    return text.length <= 10_000_000 ? text : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverFromSitemaps(
  store: StoreDefinition,
  options: { maxDocuments?: number; maxProducts?: number } = {}
): Promise<string[]> {
  const maxDocuments = options.maxDocuments ?? 30;
  const maxProducts = options.maxProducts ?? 200;
  const queue = [...store.sitemapUrls];
  const visited = new Set<string>();
  const products = new Set<string>();

  while (queue.length > 0 && visited.size < maxDocuments && products.size < maxProducts) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const xml = await fetchSitemap(url);
    if (!xml) continue;

    for (const productUrl of sitemapProductUrls(xml, store)) {
      products.add(productUrl);
      if (products.size >= maxProducts) break;
    }

    for (const child of nestedSitemapUrls(xml)) {
      if (!visited.has(child) && queue.length + visited.size < maxDocuments) queue.push(child);
    }
  }

  return [...products];
}
