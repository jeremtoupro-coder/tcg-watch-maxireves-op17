import {
  DEFAULT_CLOUDFLARE_STORES,
  isStoreKey,
  selectConnectors
} from "./connectors";
import { evaluateCandidates } from "./engine";
import { loadOfficialCalendar } from "./officialCalendar";
import {
  buildActiveWatchConfig,
  qualifyCandidateForActiveProducts,
  type ActiveCandidateRejectionReason,
  type OfficialProduct
} from "./opwatchV1";
import { createStateStore, scopedStateStore, type StateStore } from "./state";
import { auditStore, hasConfiguredAuthorizedFeed } from "./storeAudit";
import { canonicalProductUrl } from "./connectorUrls";
import {
  buildAllOnePieceWatchConfig,
  qualifyCandidateForAllOnePiece,
  type AllCandidateRejectionReason
} from "./watchModes";
import type { Env, LanguageStatus, ProductCandidate, StoreAudit, StoreKey, WatchConfig } from "./types";
import opWatchV1Config from "../config/opwatch-v1.json";

const DISCOVERY_INTERVAL_MINUTES = 15;
const DISCOVERY_INTERVAL_MS = DISCOVERY_INTERVAL_MINUTES * 60_000;
const DISCOVERY_CACHE_VERSION = 1;
const MINIMUM_LANGUAGE_CONFIDENCE = opWatchV1Config.language.minimumAlertConfidence;

export interface MonitoringCircuitAnalysis {
  scanned: boolean;
  observedCandidates: number;
  candidates: number;
  rejectedCandidates: number;
  rejectionReasons: Record<string, number>;
  commerciallyIneligibleCandidates: number;
  alerts: number;
  discordAttempted: number;
  discordSent: number;
  discordErrors: string[];
  dedupeSuppressed: number;
}

function rejectionCounts<T extends string>(rows: Array<{ reasons: T[] }>): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const row of rows) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function emptyCircuitAnalysis(scanned: boolean): MonitoringCircuitAnalysis {
  return {
    scanned,
    observedCandidates: 0,
    candidates: 0,
    rejectedCandidates: 0,
    rejectionReasons: {},
    commerciallyIneligibleCandidates: 0,
    alerts: 0,
    discordAttempted: 0,
    discordSent: 0,
    discordErrors: [],
    dedupeSuppressed: 0
  };
}

interface DiscoveryCacheEntry {
  url: string;
  references: string[];
}

interface DiscoveryCache {
  discoveredAt: string;
  entries: DiscoveryCacheEntry[];
}

export function parseActiveStores(rawValue?: string): StoreKey[] {
  if (!rawValue?.trim()) return [...DEFAULT_CLOUDFLARE_STORES];

  const stores = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(isStoreKey);

  return [...new Set(stores)];
}

export function isDiscoveryTick(scheduledTime?: number): boolean {
  if (scheduledTime === undefined) return false;
  const minuteBucket = Math.floor(scheduledTime / 60_000);
  return minuteBucket % DISCOVERY_INTERVAL_MINUTES === 0;
}

function discoveryCacheKey(store: StoreKey): string {
  return `discovery:v${DISCOVERY_CACHE_VERSION}:${store}`;
}

function connectorHosts(connector: ReturnType<typeof selectConnectors>[number]): Set<string> {
  return new Set(connector.sources.flatMap((source) => {
    try { return [new URL(source).hostname]; } catch { return []; }
  }));
}

function normalizedFastWatchUrl(
  url: string,
  connector: ReturnType<typeof selectConnectors>[number]
): string | undefined {
  try {
    const normalized = canonicalProductUrl(url, connector);
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" &&
      connectorHosts(connector).has(parsed.hostname) &&
      connector.productUrlPatterns.some((pattern) => pattern.test(parsed.toString()))
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

function parseDiscoveryCache(raw?: string): DiscoveryCache | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryCache>;
    if (typeof parsed.discoveredAt !== "string" || !Array.isArray(parsed.entries)) return undefined;
    const entries = parsed.entries.filter((entry): entry is DiscoveryCacheEntry =>
      Boolean(entry) &&
      typeof entry.url === "string" &&
      Array.isArray(entry.references) &&
      entry.references.every((reference) => typeof reference === "string")
    );
    return { discoveredAt: parsed.discoveredAt, entries };
  } catch {
    return undefined;
  }
}

async function discoveryDue(
  stateStore: StateStore,
  scheduledTime: number | undefined,
  forced: boolean
): Promise<boolean> {
  if (forced) return true;
  const now = scheduledTime ?? Date.now();
  const last = await stateStore.getMetadata("monitor:last-discovery");
  const lastMs = last ? Date.parse(last) : Number.NaN;
  return !Number.isFinite(lastMs) || now - lastMs >= DISCOVERY_INTERVAL_MS;
}

async function fastWatchConnector(
  connector: ReturnType<typeof selectConnectors>[number],
  stateStore: StateStore,
  activeIds: Set<string>
): Promise<ReturnType<typeof selectConnectors>[number] | undefined> {
  // Sans référence active Bandai il n'y a rien à relire à la minute. Le
  // circuit ONE PIECE ALL continuera néanmoins à chaque Discovery 15 min.
  if (activeIds.size === 0) return undefined;
  if (connector.authoritativeStructuredFeed) return connector;

  // Une fiche HTML ordinaire n'entre en Fast Watch qu'après une Discovery saine
  // qui a confirmé produit actif, format, FR, disponibilité et, pour une
  // marketplace, le vendeur officiel requis. Une URL configurée seule ne suffit
  // jamais à promouvoir une marketplace en polling minute.
  const cached = parseDiscoveryCache(await stateStore.getMetadata(discoveryCacheKey(connector.key)));
  const cachedUrls = (cached?.entries ?? [])
    .filter((entry) => entry.references.some((reference) => activeIds.has(reference)))
    .flatMap((entry) => {
      const normalized = normalizedFastWatchUrl(entry.url, connector);
      return normalized ? [normalized] : [];
    });
  const sources = [...new Set(cachedUrls)];
  if (sources.length === 0) return undefined;
  return {
    ...connector,
    sources,
    followDiscoveredProductPages: false
  };
}

async function persistDiscoveryCache(
  audit: StoreAudit,
  connector: ReturnType<typeof selectConnectors>[number],
  stateStore: StateStore,
  officialProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[],
  discoveredAt: string
): Promise<void> {
  if (!stateStore.writable || connector.authorizedFeedEnv || connector.authoritativeStructuredFeed) return;

  const entries = audit.candidates.flatMap((candidate) => {
    const qualified = qualifyCandidateForActiveProducts(
      candidate,
      officialProducts,
      acceptedLanguages,
      MINIMUM_LANGUAGE_CONFIDENCE
    ).candidate;
    if (!qualified) return [];
    const normalized = normalizedFastWatchUrl(qualified.url, connector);
    return normalized ? [{
      url: normalized,
      references: [...new Set(qualified.matchedReferences)].sort()
    }] : [];
  });
  const unique = [...new Map(entries.map((entry) => [entry.url, entry])).values()];
  await stateStore.putMetadata(discoveryCacheKey(connector.key), JSON.stringify({
    discoveredAt,
    entries: unique
  } satisfies DiscoveryCache));
}

function emptyReleaseWatchConfig(acceptedLanguages: LanguageStatus[]): WatchConfig {
  return {
    version: 3,
    settings: {
      notifyOnInitialDiscovery: false,
      defaultLanguages: acceptedLanguages
    },
    products: [],
    alerts: []
  };
}

/**
 * Le gestionnaire externe appelle ce cycle à la cadence Fast Watch. Les
 * fiches déjà découvertes et qualifiées sont relues à chaque passage ; les
 * catégories et boutiques discovery-only ne sont explorées que toutes les
 * 15 minutes. Le même audit de Discovery alimente deux circuits distincts :
 * les Nouvelles sorties pilotées par Bandai et ONE PIECE ALL pour les restocks
 * historiques. Aucune origine n'est interrogée deux fois pour alimenter ALL.
 */
export async function runMonitoringCycle(
  env: Env,
  options: {
    scheduledTime?: number;
    forceStore?: StoreKey;
    forceDiscovery?: boolean;
    officialProducts?: OfficialProduct[];
    /** Catalogue Bandai complet, utilisé pour empêcher ALL de classer une future référence non publiée comme historique. */
    officialCatalogProductIds?: string[];
    acceptedLanguages?: LanguageStatus[];
    extraSourcesByStore?: Partial<Record<StoreKey, string[]>>;
    stateStore?: StateStore;
    now?: Date;
  } = {}
): Promise<{
  status: "disabled" | "completed";
  stores?: StoreKey[];
  deferredDiscoveryStores?: StoreKey[];
  deferredFastWatchStores?: StoreKey[];
  pendingAuthorizedFeedStores?: StoreKey[];
  healthyStores?: StoreKey[];
  degradedStores?: Array<{ store: StoreKey; errors: string[] }>;
  reason?: string;
  audits?: StoreAudit[];
  evaluation?: Awaited<ReturnType<typeof evaluateCandidates>>;
  allEvaluation?: Awaited<ReturnType<typeof evaluateCandidates>>;
  analysis?: {
    newReleases: MonitoringCircuitAnalysis;
    onePieceAll: MonitoringCircuitAnalysis;
  };
}> {
  if (env.MONITORING_ENABLED !== "true") {
    return {
      status: "disabled",
      reason: "MONITORING_ENABLED n'est pas activé."
    };
  }

  if (!env.TCG_STATE && !options.stateStore) {
    throw new Error("Le binding TCG_STATE est obligatoire pour la surveillance.");
  }

  if (env.WRITE_STATE !== "true") {
    throw new Error("WRITE_STATE doit être activé pour une surveillance persistante.");
  }

  const activeStores = options.forceStore
    ? [options.forceStore]
    : parseActiveStores(env.ACTIVE_STORES);
  const requestedConnectors = selectConnectors(activeStores).map((connector) => {
    const extras = options.extraSourcesByStore?.[connector.key] ?? [];
    if (extras.length === 0 || connector.directPollingDisabledWithoutFeed === true) return connector;
    return { ...connector, sources: [...new Set([...connector.sources, ...extras])] };
  });
  const acceptedLanguages = options.acceptedLanguages?.length
    ? [...new Set(options.acceptedLanguages)]
    : ["Français confirmé" as LanguageStatus];

  if (requestedConnectors.length === 0) {
    return {
      status: "disabled",
      reason: "Aucune boutique active."
    };
  }

  const stateStore = options.stateStore ?? createStateStore(env);
  let officialProducts = options.officialProducts;
  let officialCatalogProductIds = options.officialCatalogProductIds;
  if (!officialProducts) {
    const calendar = await loadOfficialCalendar({
      sourceUrl: opWatchV1Config.officialCatalogUrl,
      now: options.now,
      daysBefore: opWatchV1Config.watchWindow.daysBeforeRelease,
      daysAfter: opWatchV1Config.watchWindow.daysAfterRelease,
      stateStore
    });
    officialProducts = calendar.activeProducts;
    officialCatalogProductIds ??= calendar.catalogProducts.map((product) => product.id);
  }
  const dynamicConfig = officialProducts.length > 0
    ? buildActiveWatchConfig(officialProducts, acceptedLanguages)
    : emptyReleaseWatchConfig(acceptedLanguages);

  const includeDiscoveryOnly = await discoveryDue(
    stateStore,
    options.scheduledTime,
    options.forceDiscovery === true
  );
  const afterDiscoveryCadence = requestedConnectors.filter((connector) =>
    connector.commercialAlertsEnabled !== false || includeDiscoveryOnly
  );
  const deferredDiscoveryStores = requestedConnectors
    .filter((connector) => connector.commercialAlertsEnabled === false && !includeDiscoveryOnly)
    .map((connector) => connector.key);

  const pendingAuthorizedFeedStores = afterDiscoveryCadence
    .filter((connector) =>
      connector.directPollingDisabledWithoutFeed === true &&
      !hasConfiguredAuthorizedFeed(connector, env)
    )
    .map((connector) => connector.key);
  const pendingFeedKeys = new Set(pendingAuthorizedFeedStores);
  const eligibleConnectors = afterDiscoveryCadence.filter((connector) => !pendingFeedKeys.has(connector.key));
  const activeIds = new Set(officialProducts.map((product) => product.id));
  const selectedForCadence = includeDiscoveryOnly
    ? eligibleConnectors.map((connector) => ({ original: connector, fast: connector }))
    : await Promise.all(eligibleConnectors.map(async (connector) => ({
        original: connector,
        fast: connector.authorizedFeedEnv && hasConfiguredAuthorizedFeed(connector, env) && activeIds.size > 0
          ? connector
          : await fastWatchConnector(connector, stateStore, activeIds)
      })));
  const deferredFastWatchStores = includeDiscoveryOnly
    ? []
    : selectedForCadence.filter((entry) => !entry.fast).map((entry) => entry.original.key);
  const connectors = selectedForCadence.flatMap((entry) => entry.fast ? [entry.fast] : []);

  if (connectors.length === 0) {
    const evaluation = await evaluateCandidates([], env, {
      baselineStores: [],
      config: dynamicConfig,
      stateStore
    });
    return {
      status: "completed",
      stores: [],
      deferredDiscoveryStores,
      deferredFastWatchStores,
      pendingAuthorizedFeedStores,
      healthyStores: [],
      degradedStores: [],
      audits: [],
      evaluation,
      analysis: {
        newReleases: emptyCircuitAnalysis(officialProducts.length > 0),
        onePieceAll: emptyCircuitAnalysis(includeDiscoveryOnly)
      }
    };
  }

  const audits = await Promise.all(connectors.map((connector) => auditStore(
    connector,
    env,
    officialProducts,
    { allowPublicFallback: includeDiscoveryOnly }
  )));
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const degradedStores = audits
    .map((audit) => ({
      store: audit.store,
      errors: audit.sources.filter((source) => source.error).map((source) => source.error as string)
    }))
    .filter((entry) => entry.errors.length > 0);
  const degradedKeys = new Set(degradedStores.map((entry) => entry.store));
  const healthyAudits = audits.filter((audit) => !degradedKeys.has(audit.store));
  const healthyStores = healthyAudits.map((audit) => audit.store);

  if (includeDiscoveryOnly) {
    const discoveredAt = new Date(options.scheduledTime ?? Date.now()).toISOString();
    for (const audit of healthyAudits) {
      const connector = connectorByKey.get(audit.store);
      if (connector) {
        await persistDiscoveryCache(audit, connector, stateStore, officialProducts, acceptedLanguages, discoveredAt);
      }
    }
    if (stateStore.writable) {
      await stateStore.putMetadata("monitor:last-discovery", discoveredAt);
    }
  }

  const observedReleaseCandidates = healthyAudits.flatMap((audit) => {
    const connector = connectorByKey.get(audit.store);
    if (connector?.commercialAlertsEnabled === false) return [];
    return audit.candidates;
  });
  const releaseQualifications = observedReleaseCandidates.map((candidate) =>
    qualifyCandidateForActiveProducts(
      candidate,
      officialProducts,
      acceptedLanguages,
      MINIMUM_LANGUAGE_CONFIDENCE
    )
  );
  const candidates = releaseQualifications
    .map((qualification) => qualification.candidate)
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const baselineStores = healthyStores.filter((store) =>
    connectorByKey.get(store)?.commercialAlertsEnabled !== false
  );

  const evaluation = await evaluateCandidates(candidates, env, {
    baselineStores,
    config: dynamicConfig,
    stateStore
  });

  let allEvaluation: Awaited<ReturnType<typeof evaluateCandidates>> | undefined;
  let allObservedCandidates: ProductCandidate[] = [];
  let allQualifications: ReturnType<typeof qualifyCandidateForAllOnePiece>[] = [];
  let allCandidatesCount = 0;
  if (includeDiscoveryOnly) {
    allObservedCandidates = healthyAudits.flatMap((audit) => {
      const connector = connectorByKey.get(audit.store);
      if (connector?.commercialAlertsEnabled === false) return [];
      return audit.candidates;
    });
    allQualifications = allObservedCandidates.map((candidate) =>
      qualifyCandidateForAllOnePiece(
        candidate,
        acceptedLanguages,
        MINIMUM_LANGUAGE_CONFIDENCE,
        officialCatalogProductIds
      )
    );
    const allCandidates = allQualifications
      .map((qualification) => qualification.candidate)
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    allCandidatesCount = allCandidates.length;
    const allConfig = buildAllOnePieceWatchConfig(allCandidates, activeIds, acceptedLanguages);
    allEvaluation = await evaluateCandidates(allCandidates, env, {
      baselineStores,
      config: allConfig,
      stateStore: scopedStateStore(stateStore, "one-piece-all")
    });
  }

  const releaseDedupe = evaluation.deliveryDedupe;
  const allDedupe = allEvaluation?.deliveryDedupe;
  const releaseAnalysis: MonitoringCircuitAnalysis = {
    scanned: officialProducts.length > 0,
    observedCandidates: observedReleaseCandidates.length,
    candidates: candidates.length,
    rejectedCandidates: releaseQualifications.filter((entry) => !entry.candidate).length,
    rejectionReasons: rejectionCounts<ActiveCandidateRejectionReason>(releaseQualifications),
    commerciallyIneligibleCandidates: observedReleaseCandidates.filter((candidate) => candidate.commercialEligible === false).length,
    alerts: evaluation.alertMatches.length,
    discordAttempted: evaluation.discordDispatch.attempted,
    discordSent: evaluation.discordDispatch.sent,
    discordErrors: evaluation.discordDispatch.errors.slice(0, 8),
    dedupeSuppressed: releaseDedupe.suppressedByClaim + releaseDedupe.suppressedByReceipt
  };
  const allAnalysis: MonitoringCircuitAnalysis = {
    scanned: includeDiscoveryOnly,
    observedCandidates: allObservedCandidates.length,
    candidates: allCandidatesCount,
    rejectedCandidates: allQualifications.filter((entry) => !entry.candidate).length,
    rejectionReasons: rejectionCounts<AllCandidateRejectionReason>(allQualifications),
    commerciallyIneligibleCandidates: allQualifications.filter((entry) => entry.candidate?.commercialEligible === false).length,
    alerts: allEvaluation?.alertMatches.length ?? 0,
    discordAttempted: allEvaluation?.discordDispatch.attempted ?? 0,
    discordSent: allEvaluation?.discordDispatch.sent ?? 0,
    discordErrors: allEvaluation?.discordDispatch.errors.slice(0, 8) ?? [],
    dedupeSuppressed: (allDedupe?.suppressedByClaim ?? 0) + (allDedupe?.suppressedByReceipt ?? 0)
  };

  return {
    status: "completed",
    stores: connectors.map((connector) => connector.key),
    deferredDiscoveryStores,
    deferredFastWatchStores,
    pendingAuthorizedFeedStores,
    healthyStores,
    degradedStores,
    audits: audits.map((audit) => degradedKeys.has(audit.store) ? { ...audit, candidates: [] } : audit),
    evaluation,
    ...(allEvaluation ? { allEvaluation } : {}),
    analysis: {
      newReleases: releaseAnalysis,
      onePieceAll: allAnalysis
    }
  };
}
