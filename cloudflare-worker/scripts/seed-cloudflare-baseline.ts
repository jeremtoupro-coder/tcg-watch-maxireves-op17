import { writeFile } from "node:fs/promises";
import { auditConnector } from "../src/audit";
import { ludotrotter } from "../src/connectors/ludotrotter";
import { maxireves } from "../src/connectors/maxireves";
import { oupi } from "../src/connectors/oupi";
import { evaluateCandidates } from "../src/engine";
import type { StateStore } from "../src/state";
import type { ProductSnapshot, StoreKey } from "../src/types";

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
}

interface KvNamespace {
  id: string;
  title: string;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE ?? "tcg-watch-state";

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont obligatoires.");
}

async function cloudflareFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init.headers ?? {})
    }
  });
}

async function resolveNamespaceId(): Promise<string> {
  const response = await cloudflareFetch(
    `/accounts/${accountId}/storage/kv/namespaces?per_page=100`
  );

  if (!response.ok) {
    throw new Error(`Impossible de lister les namespaces KV: HTTP ${response.status}`);
  }

  const payload = await response.json() as CloudflareEnvelope<KvNamespace[]>;
  if (!payload.success) {
    throw new Error(`Cloudflare refuse la liste KV: ${JSON.stringify(payload.errors ?? [])}`);
  }

  const matches = payload.result.filter((namespace) => namespace.title === namespaceTitle);
  if (matches.length !== 1) {
    throw new Error(
      `Namespace KV '${namespaceTitle}' introuvable ou ambigu (${matches.length} résultat(s)).`
    );
  }

  return matches[0].id;
}

class CloudflareApiStateStore implements StateStore {
  readonly mode = "cloudflare-api" as const;
  readonly writable = true;

  constructor(private readonly namespaceId: string) {}

  private valuePath(key: string): string {
    return `/accounts/${accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(key)}`;
  }

  private async getText(key: string): Promise<string | undefined> {
    const response = await cloudflareFetch(this.valuePath(key));
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Lecture KV impossible pour ${key}: HTTP ${response.status}`);
    return response.text();
  }

  private async putText(key: string, value: string): Promise<void> {
    const response = await cloudflareFetch(this.valuePath(key), {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: value
    });

    if (!response.ok) {
      throw new Error(`Écriture KV impossible pour ${key}: HTTP ${response.status}`);
    }

    const payload = await response.json() as CloudflareEnvelope<unknown>;
    if (!payload.success) {
      throw new Error(`Cloudflare refuse l'écriture KV ${key}: ${JSON.stringify(payload.errors ?? [])}`);
    }
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

const connectors = [maxireves, ludotrotter, oupi];
const baselineStores = connectors.map((connector) => connector.key) as StoreKey[];
const namespaceId = await resolveNamespaceId();
const stateStore = new CloudflareApiStateStore(namespaceId);
const incompleteStores: StoreKey[] = [];

for (const store of baselineStores) {
  const marker = await stateStore.getMetadata(`baseline:config-v1:${store}`);
  if (marker !== "complete") incompleteStores.push(store);
}

if (incompleteStores.length === 0) {
  const report = {
    mode: "BASELINE_ALREADY_COMPLETE",
    checkedAt: new Date().toISOString(),
    namespaceTitle,
    stores: baselineStores
  };
  await writeFile("baseline-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("La base initiale est déjà complète pour les trois boutiques.");
  process.exit(0);
}

const selectedConnectors = connectors.filter((connector) => incompleteStores.includes(connector.key));
const audits = [];

for (const connector of selectedConnectors) {
  console.log(`Audit initial de ${connector.name}...`);
  const audit = await auditConnector(connector);
  audits.push(audit);

  const errors = audit.sources.filter((source) => source.error);
  if (errors.length > 0) {
    throw new Error(
      `Initialisation annulée pour ${connector.name}: ${errors.map((source) => source.error).join(", ")}`
    );
  }
}

const candidates = audits.flatMap((audit) => audit.candidates);
const evaluation = await evaluateCandidates(candidates, {
  AUDIT_MODE: "true",
  WRITE_STATE: "true",
  DISCORD_MODE: "dry-run"
}, {
  stateStore,
  baselineStores: incompleteStores
});

if (evaluation.discordDispatch.sent !== 0) {
  throw new Error("Sécurité violée: un message Discord a été envoyé pendant l'initialisation.");
}

const report = {
  mode: "BASELINE_SEEDED",
  checkedAt: new Date().toISOString(),
  namespaceTitle,
  initializedStores: incompleteStores,
  auditCount: audits.length,
  candidateCount: candidates.length,
  evaluation
};

await writeFile("baseline-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Base initiale créée pour: ${incompleteStores.join(", ")}`);
console.log(`Fiches enregistrées: ${evaluation.state.writes}`);
console.log(`Alertes envoyées: ${evaluation.discordDispatch.sent}`);
