import { fantasySphere } from "./fantasySphere";
import { maxireves } from "./maxireves";
import { oupi } from "./oupi";
import { pixelheart } from "./pixelheart";
import { ROLLOUT_CONNECTORS } from "./rollout";
import type { ConnectorDefinition, StoreKey } from "../types";

export const CONNECTORS: ConnectorDefinition[] = [
  maxireves,
  oupi,
  pixelheart,
  fantasySphere,
  ...ROLLOUT_CONNECTORS
];

export const DEFAULT_CLOUDFLARE_STORES: StoreKey[] = CONNECTORS.map((connector) => connector.key);

export function selectConnectors(storeKeys: StoreKey[]): ConnectorDefinition[] {
  const requested = new Set(storeKeys);
  return CONNECTORS.filter((connector) => requested.has(connector.key));
}

export function isStoreKey(value: string): value is StoreKey {
  return CONNECTORS.some((connector) => connector.key === value);
}
