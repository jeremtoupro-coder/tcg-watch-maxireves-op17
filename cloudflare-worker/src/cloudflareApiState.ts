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

export const CLOUDFLARE_API_STATE_VERSION = 1;
