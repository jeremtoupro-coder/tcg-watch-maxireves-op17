import { auditConnector } from "./audit";
import { auditAuthorizedFeed } from "./authorizedFeed";
import { auditParkagePublicCatalog } from "./parkagePublicCatalog";
import { auditPhilibertPublicCatalog } from "./philibertPublicCatalog";
import type { OfficialProduct } from "./opwatchV1";
import type {
  ConnectorDefinition,
  Env,
  StoreAudit,
  StoreConfiguredStatus
} from "./types";

function readEnvString(env: Env, key?: string): string | undefined {
  if (!key) return undefined;
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

/**
 * Une boutique protégée peut basculer vers un flux produit obtenu auprès de
 * son programme d'affiliation / partenaire. L'URL reste un secret Cloudflare
 * et n'est jamais incluse dans le rapport d'audit.
 */
export async function auditStore(connector: ConnectorDefinition, env: Env, watchProducts: OfficialProduct[] = []): Promise<StoreAudit> {
  const feedUrl = configuredAuthorizedFeedUrl(connector, env);
  if (feedUrl) {
    return withOperationalStatus(
      await auditAuthorizedFeed(connector, feedUrl),
      connector,
      env,
      "authorized_feed"
    );
  }

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

  if (connector.key === "philibert") {
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
