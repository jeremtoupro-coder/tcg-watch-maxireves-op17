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
    await this.putText(key, JSON.stringify(value));
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return this.getText(`metadata:${key}`);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    await this.putText(`metadata:${key}`, value);
  }
}

export async function createCloudflareApiStateStore(
  credentials: CloudflareApiCredentials
): Promise<CloudflareApiStateStore> {
  const namespaceId = await resolveKvNamespaceId(credentials);
  return new CloudflareApiStateStore(credentials, namespaceId);
}
