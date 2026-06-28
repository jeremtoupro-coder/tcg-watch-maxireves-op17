import { writeFile } from "node:fs/promises";
import { auditConnector } from "../src/audit";
import { createConfiguredConnector } from "../src/connectorBuilder";
import { evaluateCandidates } from "../src/engine";
import { getEnabledStoreDefinitions } from "../src/storeConfig";
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
const requestedMode = process.env.MONITOR_MODE === "live" ? "live" : "baseline";
const discordEndpoint = process.env.DISCORD_WEBHOOK_URL;

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont obligatoires.");
}
if (requestedMode === "live" && !discordEndpoint) {
  throw new Error("Le canal Discord est obligatoire en mode live.");
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
  if (!response.ok) throw new Error(`Liste KV impossible: HTTP ${response.status}`);

  const payload = await response.json() as CloudflareEnvelope<KvNamespace[]>;
  const matches = payload.result.filter((namespace) => namespace.title === namespaceTitle);
  if (!payload.success || matches.length !== 1) {
    throw new Error(`Namespace KV introuvable ou ambigu: ${namespaceTitle}`);
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

const connectors = [];
for (const store of getEnabledStoreDefinitions()) {
  connectors.push(await createConfiguredConnector(store));
}

const baselineStores = connectors.map((connector) => connector.key) as StoreKey[];
const namespaceId = await resolveNamespaceId();
const stateStore = new CloudflareApiStateStore(namespaceId);
const incompleteStores: StoreKey[] = [];

for (const store of baselineStores) {
  const marker = await stateStore.getMetadata(`baseline:config-v2:${store}`);
  if (marker !== "complete") incompleteStores.push(store);
}

if (incompleteStores.length === 0) {
  const report = {
    mode: "BASELINE_ALREADY_COMPLETE",
    requestedMode,
    checkedAt: new Date().toISOString(),
    namespaceTitle,
    stores: baselineStores
  };
  await writeFile("baseline-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("La base hybride est déjà complète pour toutes les boutiques.");
  process.exit(0);
}

const selectedConnectors = connectors.filter((connector) => incompleteStores.includes(connector.key));
const audits = [];

for (const connector of selectedConnectors) {
  console.log(`Audit initial hybride de ${connector.name}...`);
  const audit = await auditConnector(connector);
  audits.push(audit);

  if (audit.sources.every((source) => Boolean(source.error))) {
    throw new Error(`Initialisation impossible pour ${connector.name}: toutes les sources ont échoué.`);
  }
}

const candidates = audits.flatMap((audit) => audit.candidates);
const evaluation = await evaluateCandidates(candidates, {
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
  mode: "HYBRID_BASELINE_SEEDED",
  requestedMode,
  checkedAt: new Date().toISOString(),
  namespaceTitle,
  initializedStores: incompleteStores,
  sourceCount: audits.reduce((total, audit) => total + audit.sources.length, 0),
  candidateCount: candidates.length,
  stateWrites: evaluation.state.writes,
  alertsSent: evaluation.discordDispatch.sent
};

await writeFile("baseline-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
