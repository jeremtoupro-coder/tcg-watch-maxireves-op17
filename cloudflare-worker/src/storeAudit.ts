import { auditConnector, WORKERS_FREE_SUBREQUEST_LIMIT } from "./audit";
import { auditAuthorizedFeed } from "./authorizedFeed";
import { canonicalProductUrl } from "./connectorUrls";
import { auditParkagePublicCatalog } from "./parkagePublicCatalog";
import { auditPhilibertPublicCatalog } from "./philibertPublicCatalog";
import type { OfficialProduct } from "./opwatchV1";
import type { StateStore } from "./state";
import type {
  ConnectorDefinition,
  Env,
  ProductCandidate,
  StoreAudit,
  StoreConfiguredStatus
} from "./types";

function readEnvString(env: Env, key?: string): string | undefined {
  if (!key) return undefined;
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeSourceLabel(value: string): string {
  try { return new URL(value).hostname || "feed partenaire"; } catch { return "feed partenaire"; }
}

export function configuredAuthorizedFeedUrl(connector: ConnectorDefinition, env: Env): string | undefined {
  return readEnvString(env, connector.authorizedFeedEnv);
}

export function hasConfiguredAuthorizedFeed(connector: ConnectorDefinition, env: Env): boolean {
  return Boolean(configuredAuthorizedFeedUrl(connector, env));
}

export function configuredStoreStatus(
  connector: ConnectorDefinition,
  env: Env
): StoreConfiguredStatus {
  if (connector.commercialAlertsEnabled === false) return "discovery_only";
  if (
    connector.directPollingDisabledWithoutFeed === true &&
    !hasConfiguredAuthorizedFeed(connector, env)
  ) {
    return "pending_authorized_feed";
  }
  return "active_fast_watch";
}

function withOperationalStatus(
  audit: StoreAudit,
  connector: ConnectorDefinition,
  env: Env,
  sourceKind: StoreAudit["sourceKind"]
): StoreAudit {
  const configuredStatus = configuredStoreStatus(connector, env);
  const hasErrors = audit.sources.some((source) => Boolean(source.error));
  const hasHealthySource = audit.sources.some((source) => !source.error);
  const onlyDeferredSources = audit.sources.length > 0 && audit.sources.every((source) => source.deferred === true);
  const runtimeStatus = configuredStatus === "pending_authorized_feed"
    ? "pending"
    : configuredStatus === "disabled"
      ? "disabled"
      : hasErrors || !hasHealthySource
        ? "degraded"
        : "healthy";

  return {
    ...audit,
    configuredStatus,
    runtimeStatus,
    sourceKind,
    fastWatchCapable: configuredStatus === "active_fast_watch" && runtimeStatus === "healthy" && !onlyDeferredSources,
    discoveryCapable:
      configuredStatus !== "disabled" &&
      configuredStatus !== "pending_authorized_feed" &&
      runtimeStatus === "healthy",
    commercialEligible: configuredStatus === "active_fast_watch" && runtimeStatus === "healthy"
  };
}

function isPhilibertRssDiscovery(connector: ConnectorDefinition): boolean {
  return connector.key === "philibert" && connector.sources.some((source) =>
    /philibertnet\.com\/modules\/feeder\/rss\.php\?id_category=15860/i.test(source)
  );
}

function preferDirectCandidates(
  categoryCandidates: ProductCandidate[],
  directCandidates: ProductCandidate[]
): ProductCandidate[] {
  const byUrl = new Map(categoryCandidates.map((candidate) => [candidate.url, candidate]));
  for (const candidate of directCandidates) byUrl.set(candidate.url, candidate);
  return [...byUrl.values()];
}

function publicPartnerDirectUrls(
  audit: StoreAudit,
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[]
): string[] {
  if (connector.directPollingDisabledWithoutFeed === true) return [];
  const activeIds = new Set(watchProducts.map((product) => product.id));
  if (activeIds.size === 0) return [];
  const allowedHosts = new Set(connector.sources.flatMap((source) => {
    try { return [new URL(source).hostname.toLowerCase().replace(/^www\./, "")]; } catch { return []; }
  }));
  const urls = audit.candidates.flatMap((candidate) => {
    if (!candidate.matchedReferences.some((reference) => activeIds.has(reference))) return [];
    try {
      const canonical = canonicalProductUrl(candidate.url, connector);
      const parsed = new URL(canonical);
      if (
        parsed.protocol !== "https:" ||
        !allowedHosts.has(parsed.hostname.toLowerCase().replace(/^www\./, "")) ||
        !connector.productUrlPatterns.some((pattern) => pattern.test(parsed.toString()))
      ) return [];
      return [canonical];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)].slice(0, Math.max(0, WORKERS_FREE_SUBREQUEST_LIMIT - audit.sources.length));
}

async function enrichPartnerDiscoveryWithDirectPages(
  feedAudit: StoreAudit,
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[]
): Promise<StoreAudit> {
  const directUrls = publicPartnerDirectUrls(feedAudit, connector, watchProducts);
  if (directUrls.length === 0) return feedAudit;
  const directAudit = await auditConnector({
    ...connector,
    authorizedFeedEnv: undefined,
    sources: directUrls,
    followDiscoveredProductPages: false,
    maxConcurrency: 2
  }, watchProducts);
  return {
    ...feedAudit,
    sources: [...feedAudit.sources, ...directAudit.sources],
    candidates: preferDirectCandidates(feedAudit.candidates, directAudit.candidates),
    warnings: [...(feedAudit.warnings ?? []), ...(directAudit.warnings ?? [])],
    notes: [
      ...feedAudit.notes,
      "Discovery via feed partenaire ; les fiches directes actives qualifiées alimentent ensuite le Fast Watch minute."
    ]
  };
}

/**
 * Esprit Jeu publie déjà disponibilité et prix dans sa catégorie One Piece.
 * Ouvrir aveuglément toutes les anciennes fiches à chaque Discovery gaspille
 * du budget et charge inutilement le marchand. On lit donc tout le catalogue,
 * puis on valide une fiche directe uniquement lorsque :
 * - la référence appartient aux sorties Bandai actuellement actives ; ou
 * - un ancien produit est annoncé disponible par le catalogue.
 *
 * Les candidats catégorie restent dans le résultat pour alimenter l'état ALL
 * (notamment disponible -> indisponible). Une alerte commerciale exige toujours
 * une fiche directe : alerts.ts refuse explicitement les candidats non éligibles.
 */
async function auditEspritJeuCatalog(
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[]
): Promise<StoreAudit> {
  const categoryAudit = await auditConnector({
    ...connector,
    followDiscoveredProductPages: false
  }, watchProducts);

  if (categoryAudit.sources.some((source) => Boolean(source.error))) return categoryAudit;

  const activeIds = new Set(watchProducts.map((product) => product.id));
  const eligibleDirectCandidates = categoryAudit.candidates
    .filter((candidate) =>
      candidate.availability === "available" ||
      candidate.matchedReferences.some((reference) => activeIds.has(reference))
    )
    .sort((left, right) => {
      const leftActive = left.matchedReferences.some((reference) => activeIds.has(reference));
      const rightActive = right.matchedReferences.some((reference) => activeIds.has(reference));
      return Number(rightActive) - Number(leftActive);
    });
  const allDirectUrls = [...new Set(eligibleDirectCandidates.map((candidate) => candidate.url))];
  const directBudget = Math.max(0, WORKERS_FREE_SUBREQUEST_LIMIT - categoryAudit.sources.length);
  const directUrls = allDirectUrls.slice(0, directBudget);

  if (directUrls.length === 0) return categoryAudit;

  const directAudit = await auditConnector({
    ...connector,
    sources: directUrls,
    followDiscoveredProductPages: false,
    maxConcurrency: 2
  }, watchProducts);

  return {
    store: connector.key,
    storeName: connector.name,
    checkedAt: new Date().toISOString(),
    sources: [...categoryAudit.sources, ...directAudit.sources],
    candidates: preferDirectCandidates(categoryAudit.candidates, directAudit.candidates),
    notes: connector.notes,
    ...(allDirectUrls.length > directUrls.length
      ? { warnings: [`${allDirectUrls.length - directUrls.length} fiches Esprit Jeu reportées afin de respecter la limite Free de ${WORKERS_FREE_SUBREQUEST_LIMIT} sous-requêtes par cycle.`] }
      : {})
  };
}

async function auditPublicStore(
  connector: ConnectorDefinition,
  env: Env,
  watchProducts: OfficialProduct[]
): Promise<StoreAudit> {
  if (connector.directPollingDisabledWithoutFeed === true) {
    return withOperationalStatus({
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [],
      candidates: [],
      notes: [
        ...connector.notes,
        `Flux autorisé en attente (${connector.authorizedFeedEnv ?? "secret non déclaré"}) : origine protégée non interrogée.`
      ]
    }, connector, env, "none");
  }

  if (connector.key === "parkage") {
    return withOperationalStatus(
      await auditParkagePublicCatalog(connector),
      connector,
      env,
      "public_structured_feed"
    );
  }

  if (connector.key === "esprit-jeu" && connector.followDiscoveredProductPages === true) {
    return withOperationalStatus(
      await auditEspritJeuCatalog(connector, watchProducts),
      connector,
      env,
      "public_html"
    );
  }

  if (isPhilibertRssDiscovery(connector)) {
    return withOperationalStatus(
      await auditPhilibertPublicCatalog(connector, watchProducts),
      connector,
      env,
      "public_structured_feed"
    );
  }

  return withOperationalStatus(
    await auditConnector(connector, watchProducts),
    connector,
    env,
    connector.authoritativeStructuredFeed ? "public_structured_feed" : "public_html"
  );
}

/**
 * Un flux produit partenaire est prioritaire lorsqu'il est configuré.
 * Pour les marchands dont le site public reste une source autorisée et saine
 * (JouéClub, La Grande Récré, BCD Jeux), une panne du feed ne doit pas créer
 * un angle mort : on retombe sur la stratégie publique existante pour ce cycle.
 * Les marchands protégés par anti-bot restent strictement fail-closed.
 */
export async function auditStore(
  connector: ConnectorDefinition,
  env: Env,
  watchProducts: OfficialProduct[] = [],
  options: { allowPublicFallback?: boolean; stateStore?: StateStore } = {}
): Promise<StoreAudit> {
  const feedUrl = configuredAuthorizedFeedUrl(connector, env);
  if (feedUrl) {
    const rawFeedAudit = await auditAuthorizedFeed(connector, feedUrl, {
      stateStore: options.stateStore,
      // Une Discovery reparcourt toujours le catalogue : un nouveau produit
      // Bandai peut devenir actif alors que le contenu/ETag du feed n'a pas changé.
      forceRefresh: options.allowPublicFallback === true
    });
    const rawFeedHealthy = rawFeedAudit.sources.length > 0 && rawFeedAudit.sources.every((source) => !source.error);
    const feedAudit = rawFeedHealthy && options.allowPublicFallback === true
      ? await enrichPartnerDiscoveryWithDirectPages(rawFeedAudit, connector, watchProducts)
      : rawFeedAudit;
    const feedHealthy = feedAudit.sources.length > 0 && feedAudit.sources.every((source) => !source.error);
    if (feedHealthy || connector.directPollingDisabledWithoutFeed === true) {
      return withOperationalStatus(feedAudit, connector, env, "authorized_feed");
    }

    // Le fallback HTML sert de filet Discovery au quart d'heure. Il ne doit
    // jamais être martelé toutes les minutes lorsqu'un feed configuré tombe :
    // le Fast Watch reste alors explicitement dégradé jusqu'au retour du feed.
    if (options.allowPublicFallback === false) {
      return withOperationalStatus(feedAudit, connector, env, "authorized_feed");
    }

    const fallback = await auditPublicStore(connector, env, watchProducts);
    const feedErrors = feedAudit.sources
      .flatMap((source) => source.error ? [`${safeSourceLabel(source.sourceUrl)}: ${source.error}`] : [])
      .slice(0, 8);
    return {
      ...fallback,
      warnings: [
        ...(fallback.warnings ?? []),
        ...feedErrors.map((error) => `Flux partenaire indisponible : ${error}`)
      ],
      notes: [
        ...fallback.notes,
        `Flux produit partenaire configuré mais indisponible sur ce cycle : fallback public utilisé${feedErrors.length ? ` (${feedErrors.join(" | ")})` : "."}`
      ]
    };
  }

  return auditPublicStore(connector, env, watchProducts);
}
