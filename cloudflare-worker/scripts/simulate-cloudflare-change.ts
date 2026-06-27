import { writeFile } from "node:fs/promises";
import { evaluateCandidates } from "../src/engine";
import { MemoryStateStore } from "../src/state";
import type { ProductCandidate, ProductSnapshot } from "../src/types";

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
}

interface KvNamespace {
  id: string;
  title: string;
}

interface KvKey {
  name: string;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE ?? "tcg-watch-state";
const discordMode = process.env.DISCORD_MODE === "live" ? "live" : "dry-run";
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont obligatoires.");
}

if (discordMode === "live" && !discordWebhookUrl) {
  throw new Error("DISCORD_WEBHOOK_URL est obligatoire pour le test Discord réel.");
}

async function cloudflareFetch(path: string): Promise<Response> {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` }
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
    throw new Error(`Namespace '${namespaceTitle}' introuvable ou ambigu.`);
  }
  return matches[0].id;
}

async function listOupiSnapshots(namespaceId: string): Promise<ProductSnapshot[]> {
  const prefix = encodeURIComponent("product:oupi:");
  const keysResponse = await cloudflareFetch(
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?prefix=${prefix}&limit=100`
  );
  if (!keysResponse.ok) throw new Error(`Liste des clés impossible: HTTP ${keysResponse.status}`);

  const keysPayload = await keysResponse.json() as CloudflareEnvelope<KvKey[]>;
  if (!keysPayload.success) throw new Error("Cloudflare refuse la liste des clés.");

  const snapshots: ProductSnapshot[] = [];
  for (const key of keysPayload.result) {
    const valueResponse = await cloudflareFetch(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key.name)}`
    );
    if (!valueResponse.ok) throw new Error(`Lecture impossible pour ${key.name}`);
    snapshots.push(await valueResponse.json() as ProductSnapshot);
  }
  return snapshots;
}

const namespaceId = await resolveNamespaceId();
const snapshots = await listOupiSnapshots(namespaceId);
const previous = snapshots.find((snapshot) =>
  snapshot.language === "Français confirmé" && snapshot.availability === "unavailable"
);

if (!previous) {
  throw new Error("Aucune fiche Oupi française indisponible n'est disponible pour la simulation.");
}

const simulatedCandidate: ProductCandidate = {
  store: previous.store,
  storeName: previous.storeName,
  title: `[TEST] ${previous.title}`,
  url: previous.url,
  sourceUrl: previous.url,
  matchedReferences: previous.matchedReferences,
  availability: "available",
  language: previous.language,
  priceText: previous.priceText,
  excerpt: "Simulation en lecture seule d'un retour en stock."
};

const stateStore = new MemoryStateStore({
  writable: false,
  seed: [previous],
  seedMetadata: {
    "baseline:config-v1:oupi": "complete"
  }
});

const evaluation = await evaluateCandidates([simulatedCandidate], {
  AUDIT_MODE: "true",
  WRITE_STATE: "false",
  DISCORD_MODE: discordMode,
  DISCORD_WEBHOOK_URL: discordWebhookUrl
}, {
  stateStore,
  baselineStores: ["oupi"],
  now: new Date().toISOString()
});

const hasBackInStock = evaluation.changes.some((change) => change.type === "back_in_stock");
if (!hasBackInStock) throw new Error("Le retour en stock simulé n'a pas été détecté.");
if (evaluation.alertMatches.length !== 1) {
  throw new Error(`Une alerte était attendue, résultat: ${evaluation.alertMatches.length}.`);
}

const expectedSent = discordMode === "live" ? 1 : 0;
if (
  evaluation.discordPayloads.length !== 1 ||
  evaluation.discordDispatch.sent !== expectedSent ||
  evaluation.discordDispatch.errors.length > 0
) {
  throw new Error(
    `Le test Discord ${discordMode} a échoué: ${JSON.stringify(evaluation.discordDispatch)}`
  );
}

const report = {
  mode: discordMode === "live"
    ? "ONE_SHOT_LIVE_DISCORD_SIMULATION"
    : "READ_ONLY_REAL_KV_SIMULATION",
  checkedAt: new Date().toISOString(),
  sourceSnapshot: {
    key: previous.key,
    store: previous.store,
    title: previous.title,
    availability: previous.availability,
    language: previous.language,
    priceText: previous.priceText
  },
  simulatedAvailability: simulatedCandidate.availability,
  evaluation
};

await writeFile(
  "change-simulation-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

console.log("Retour en stock détecté: oui");
console.log(`Alertes correspondantes: ${evaluation.alertMatches.length}`);
console.log(`Messages Discord construits: ${evaluation.discordPayloads.length}`);
console.log(`Messages Discord envoyés: ${evaluation.discordDispatch.sent}`);
console.log("Aucune donnée KV n'a été modifiée.");
