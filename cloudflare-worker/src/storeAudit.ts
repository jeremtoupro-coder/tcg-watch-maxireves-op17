import { auditConnector } from "./audit";
import { auditAuthorizedFeed } from "./authorizedFeed";
import { auditParkagePublicCatalog } from "./parkagePublicCatalog";
import { auditPhilibertPublicCatalog } from "./philibertPublicCatalog";
import type { OfficialProduct } from "./opwatchV1";
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
    fastWatchCapable: configuredStatus === "active_fast_watch" && runtimeStatus === "healthy",
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
  const directUrls = [...new Set(categoryAudit.candidates
    .filter((candidate) =>
      candidate.availability === "available" ||
      candidate.matchedReferences.some((reference) => activeIds.has(reference))
    )
    .map((candidate) => candidate.url))];

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
    notes: connector.notes
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
  options: { allowPublicFallback?: boolean } = {}
): Promise<StoreAudit> {
  const feedUrl = configuredAuthorizedFeedUrl(connector, env);
  if (feedUrl) {
    const feedAudit = await auditAuthorizedFeed(connector, feedUrl);
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
