import { getEnabledProducts } from "./config";
import { discoverFromSitemaps } from "./sitemaps";
import {
  getConfiguredDirectProducts,
  getEnabledStoreDefinitions,
  productMatchesStore,
  type StoreDefinition
} from "./storeConfig";
import type { ConnectorDefinition } from "./types";

function searchUrls(store: StoreDefinition): string[] {
  if (!store.searchUrlTemplate) return [];

  const urls = new Set<string>();
  for (const product of getEnabledProducts()) {
    if (!productMatchesStore(product, store)) continue;
    const terms = product.searchTerms?.length ? product.searchTerms : [product.id];
    for (const term of terms) {
      urls.add(store.searchUrlTemplate.replace("{query}", encodeURIComponent(term)));
    }
  }
  return [...urls];
}

export function staticSources(store: StoreDefinition): string[] {
  return [...new Set([
    ...searchUrls(store),
    ...store.categoryUrls,
    ...store.newReleaseUrls,
    ...store.directProductUrls,
    ...getConfiguredDirectProducts(store.id)
  ])];
}

export function staticConnectors(): ConnectorDefinition[] {
  return getEnabledStoreDefinitions().map((store) => ({
    key: store.id,
    name: store.name,
    sources: staticSources(store),
    productUrlPatterns: store.productUrlPatterns.map((pattern) => new RegExp(pattern, "i")),
    maxConcurrency: 6,
    notes: ["Recherche interne, catégories, nouveautés et fiches directes configurées."]
  }));
}

export async function sitemapSourcesForStore(store: StoreDefinition): Promise<string[]> {
  return discoverFromSitemaps(store);
}
