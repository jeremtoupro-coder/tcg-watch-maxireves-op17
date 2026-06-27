import { fantasySphere } from "./fantasySphere";
import { ludotrotter } from "./ludotrotter";
import { maxireves } from "./maxireves";
import { oupi } from "./oupi";
import type { ConnectorDefinition, StoreKey } from "../types";

export const CONNECTORS: ConnectorDefinition[] = [
  maxireves,
  ludotrotter,
  oupi,
  fantasySphere
];

export const DEFAULT_CLOUDFLARE_STORES: StoreKey[] = [
  "maxireves",
  "ludotrotter",
  "oupi",
  "fantasy-sphere"
];

export function selectConnectors(storeKeys: StoreKey[]): ConnectorDefinition[] {
  const requested = new Set(storeKeys);
  return CONNECTORS.filter((connector) => requested.has(connector.key));
}

export function isStoreKey(value: string): value is StoreKey {
  return CONNECTORS.some((connector) => connector.key === value);
}
