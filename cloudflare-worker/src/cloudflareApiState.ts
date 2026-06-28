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

const SUCCESS_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function samePersistedProductState(left: ProductSnapshot, right: ProductSnapshot): boolean {
  return left.key === right.key &&
    left.store === right.store &&
    left.storeName === right.storeName &&
    left.title === right.title &&
    left.url === right.url &&
    sameStringArray(left.matchedReferences, right.matchedReferences) &&
    left.availability === right.availability &&
    left.language === right.language &&
    left.priceCents === right.priceCents;
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

export class CloudflareApiStateStore implements StateStore {
  readonly mode = "cloudflare-api" as const;
  readonly writable = true;

  constructor(
    private readonly credentials: CloudflareApiCredentials,
    private readonly namespaceId: string
  ) {}

  private valuePath(key: string): string {
    return `/accounts/${this.credentials.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(key)}`;
  }

  private async getText(key: string): Promise<string | undefined> {
    const response = await apiRequest(this.credentials, this.valuePath(key));
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Lecture KV impossible pour ${key}: HTTP ${response.status}`);
    return response.text();
  }

  private async putText(key: string, value: string): Promise<void> {
    const response = await apiRequest(this.credentials, this.valuePath(key), {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: value
    });
    if (!response.ok) throw new Error(`Écriture KV impossible pour ${key}: HTTP ${response.status}`);
  }

  async get(key: string): Promise<ProductSnapshot | undefined> {
    const value = await this.getText(key);
    return value ? JSON.parse(value) as ProductSnapshot : undefined;
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    const current = await this.get(key);
    if (current && samePersistedProductState(current, value)) return;
    await this.putText(key, JSON.stringify(value));
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return this.getText(`metadata:${key}`);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    const current = await this.getMetadata(key);

    if (current === value) return;

    if (key === "external-monitor:last-success" && current) {
      const previousMs = Date.parse(current);
      const nextMs = Date.parse(value);
      if (
        Number.isFinite(previousMs) &&
        Number.isFinite(nextMs) &&
        nextMs - previousMs < SUCCESS_HEARTBEAT_INTERVAL_MS
      ) {
        return;
      }
    }

    await this.putText(`metadata:${key}`, value);
  }
}

export async function createCloudflareApiStateStore(
  credentials: CloudflareApiCredentials
): Promise<CloudflareApiStateStore> {
  const namespaceId = await resolveKvNamespaceId(credentials);
  return new CloudflareApiStateStore(credentials, namespaceId);
}

export const createRemoteState = createCloudflareApiStateStore;
