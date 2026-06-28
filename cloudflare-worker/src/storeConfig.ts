import storeRegistryJson from "../config/stores.json";
import type { StoreKey } from "./types";

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
