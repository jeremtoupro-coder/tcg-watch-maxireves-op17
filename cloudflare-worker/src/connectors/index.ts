import { bcdJeux } from "./bcdJeux";
import { espritJeu } from "./espritJeu";
import { fantasySphere } from "./fantasySphere";
import { laGrandeRecre } from "./laGrandeRecre";
import { leclerc } from "./leclerc";
import { maxireves } from "./maxireves";
import { otakuland } from "./otakuland";
import { oupi } from "./oupi";
import { parkage } from "./parkage";
import { philibert } from "./philibert";
import { pixelheart } from "./pixelheart";
import { ROLLOUT_CONNECTORS } from "./rollout";
import type { ConnectorDefinition, StoreKey } from "../types";

const rolloutConnectors = ROLLOUT_CONNECTORS.map((connector) => {
  if (connector.key === "parkage") return parkage;
  if (connector.key === "leclerc") return leclerc;
  if (connector.key === "philibert") return philibert;
  if (connector.key === "otakuland") return otakuland;
  if (connector.key === "joueclub") {
    return {
      ...connector,
      authorizedFeedEnv: "AUTHORIZED_FEED_JOUECLUB_URL",
      notes: [
        ...connector.notes,
        "Flux produits Affilae/Shopping Feed autorisé disponible : il est prioritaire lorsqu'il est configuré.",
        "Sans flux configuré, la catégorie publique JouéClub reste le fallback opérationnel."
      ]
    };
  }
  return connector;
});

export const CONNECTORS: ConnectorDefinition[] = [
  maxireves,
  oupi,
  pixelheart,
  fantasySphere,
  ...rolloutConnectors,
  espritJeu,
  laGrandeRecre,
  bcdJeux
];

export const DEFAULT_CLOUDFLARE_STORES: StoreKey[] = CONNECTORS.map((connector) => connector.key);

export function selectConnectors(storeKeys: StoreKey[]): ConnectorDefinition[] {
  const requested = new Set(storeKeys);
  return CONNECTORS.filter((connector) => requested.has(connector.key));
}

export function isStoreKey(value: string): value is StoreKey {
  return CONNECTORS.some((connector) => connector.key === value);
}
