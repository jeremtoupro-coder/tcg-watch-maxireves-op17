import { staticSources, sitemapSourcesForStore } from "./discovery";
import { getEnabledStoreDefinitions, type StoreDefinition } from "./storeConfig";
import type { ConnectorDefinition } from "./types";

async function buildOne(store: StoreDefinition): Promise<ConnectorDefinition> {
  const extraSources = await sitemapSourcesForStore(store);
  return {
    key: store.id,
    name: store.name,
    sources: [...new Set([...staticSources(store), ...extraSources])],
    productUrlPatterns: store.productUrlPatterns.map((value) => new RegExp(value, "i")),
    maxConcurrency: 6,
    notes: ["Surveillance hybride active."]
  };
}

export const CONNECTOR_BUILDER_VERSION = 1;
