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
import {
  amazonFr,
  carrefour,
  cultura,
  fnac,
  joueclub as baseJoueclub,
  kingJouet,
  ludiworld,
  ludisphere,
  micromania,
  mysticAmbre,
  playin,
  ultrajeux,
  vegastore
} from "./rollout";
import type { ConnectorDefinition, StoreKey } from "../types";

const joueclub: ConnectorDefinition = {
  ...baseJoueclub,
  authorizedFeedEnv: "AUTHORIZED_FEED_JOUECLUB_URL",
  notes: [
    ...baseJoueclub.notes,
    "Flux produits Affilae/Shopping Feed autorisé disponible : il est prioritaire lorsqu'il est configuré.",
    "Sans flux configuré, la catégorie publique JouéClub reste le fallback opérationnel."
  ]
};

export const CONNECTORS: ConnectorDefinition[] = [
  maxireves,
  oupi,
  pixelheart,
  fantasySphere,
  ludisphere,
  parkage,
  ultrajeux,
  playin,
  philibert,
  cultura,
  micromania,
  fnac,
  leclerc,
  carrefour,
  kingJouet,
  joueclub,
  amazonFr,
  mysticAmbre,
  ludiworld,
  vegastore,
  otakuland,
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
