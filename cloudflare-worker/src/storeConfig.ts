import storeRegistryJson from "../config/stores.json";
import type { ProductDefinition, StoreKey } from "./types";

export interface StoreDefinition {
  id: StoreKey;
  name: string;
  enabled: boolean;
  games: string[];
  productUrlPatterns: string[];
  searchUrlTemplate?: string;
  categoryUrls: string[];
  newReleaseUrls: string[];
  sitemapUrls: string[];
  directProductUrls: string[];
}

interface StoreRegistry {
  version: number;
  stores: StoreDefinition[];
}

export const STORE_REGISTRY = storeRegistryJson as StoreRegistry;

export function getEnabledStoreDefinitions(): StoreDefinition[] {
  return STORE_REGISTRY.stores.filter((store) => store.enabled);
}

export function getStoreDefinition(id: StoreKey): StoreDefinition | undefined {
  return STORE_REGISTRY.stores.find((store) => store.id === id);
}

export function productMatchesStore(product: ProductDefinition, store: StoreDefinition): boolean {
  return !product.game || store.games.includes(product.game);
}
