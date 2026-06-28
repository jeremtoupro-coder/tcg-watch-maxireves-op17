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
