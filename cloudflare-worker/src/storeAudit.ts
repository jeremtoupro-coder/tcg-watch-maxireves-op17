import { auditConnector } from "./audit";
import { auditAuthorizedFeed } from "./authorizedFeed";
import type { ConnectorDefinition, Env, StoreAudit } from "./types";

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

/**
 * Une boutique protégée peut basculer vers un flux produit obtenu auprès de
 * son programme d'affiliation / partenaire. L'URL reste un secret Cloudflare
 * et n'est jamais incluse dans le rapport d'audit.
 */
export async function auditStore(connector: ConnectorDefinition, env: Env): Promise<StoreAudit> {
  const feedUrl = configuredAuthorizedFeedUrl(connector, env);
  if (feedUrl) return auditAuthorizedFeed(connector, feedUrl);
  return auditConnector(connector);
}
