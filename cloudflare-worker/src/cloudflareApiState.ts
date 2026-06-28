import type { StateStore } from "./state";
import type { ProductSnapshot } from "./types";

export interface CloudflareApiCredentials {
  accountId: string;
  apiToken: string;
  namespaceTitle: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
}

interface KvNamespaceSummary {
  id: string;
  title: string;
}

async function apiRequest(
  credentials: CloudflareApiCredentials,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      ...(init.headers ?? {})
    }
  });
}

export async function resolveKvNamespaceId(
  credentials: CloudflareApiCredentials
): Promise<string> {
  const response = await apiRequest(
    credentials,
    `/accounts/${credentials.accountId}/storage/kv/namespaces?per_page=100`
  );
  if (!response.ok) throw new Error(`Liste KV impossible: HTTP ${response.status}`);

  const payload = await response.json() as CloudflareEnvelope<KvNamespaceSummary[]>;
  const matches = payload.result.filter((item) => item.title === credentials.namespaceTitle);
  if (!payload.success || matches.length !== 1) {
    throw new Error(`Namespace KV introuvable ou ambigu: ${credentials.namespaceTitle}`);
  }
  return matches[0].id;
}

export const CLOUDFLARE_API_STATE_VERSION = 1;
