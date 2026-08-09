import { writeFile } from "node:fs/promises";
import { CONNECTORS } from "../src/connectors";
import type { StoreAudit } from "../src/types";

const baseUrl = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
const auditToken = process.env.PREVIEW_AUDIT_TOKEN ?? "";
const REQUEST_TIMEOUT_MS = 90_000;
const CONCURRENCY = 3;

if (!baseUrl) throw new Error("PREVIEW_URL est obligatoire.");
if (!auditToken) throw new Error("PREVIEW_AUDIT_TOKEN est obligatoire.");

async function fetchStoreAudit(store: string): Promise<StoreAudit> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/audit?store=${encodeURIComponent(store)}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${auditToken}`,
        "User-Agent": "OPWatchPreviewAudit/1.0"
      }
    });
    const body = await response.json() as { stores?: StoreAudit[]; error?: string };
    if (!response.ok || body.stores?.length !== 1) {
      throw new Error(`HTTP ${response.status}: ${body.error ?? "réponse d'audit invalide"}`);
    }
    return body.stores[0];
  } finally {
    clearTimeout(timeout);
  }
}

const audits: StoreAudit[] = [];
const requestFailures: string[] = [];
for (let index = 0; index < CONNECTORS.length; index += CONCURRENCY) {
  const batch = CONNECTORS.slice(index, index + CONCURRENCY);
  const settled = await Promise.allSettled(batch.map((connector) => fetchStoreAudit(connector.key)));
  settled.forEach((result, offset) => {
    if (result.status === "fulfilled") {
      audits.push(result.value);
      return;
    }
    const connector = batch[offset];
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    requestFailures.push(`${connector.key}: ${reason}`);
    audits.push({
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [],
      candidates: [],
      notes: connector.notes,
      configuredStatus: connector.commercialAlertsEnabled === false
        ? "discovery_only"
        : connector.directPollingDisabledWithoutFeed === true
          ? "pending_authorized_feed"
          : "active_fast_watch",
      runtimeStatus: "degraded",
      sourceKind: "none",
      fastWatchCapable: false,
      discoveryCapable: false,
      commercialEligible: false
    });
    console.error(`${connector.name}: ${reason}`);
  });
}

const summaries = audits.map((audit) => {
  const connector = CONNECTORS.find((item) => item.key === audit.store);
  const references = [...new Set(audit.candidates.flatMap((candidate) => candidate.matchedReferences))].sort();
  const languages = [...new Set(audit.candidates.map((candidate) => candidate.language))].sort();
  const availabilities = [...new Set(audit.candidates.map((candidate) => candidate.availability))].sort();
  return {
    store: audit.store,
    storeName: audit.storeName,
    configuredStatus: audit.configuredStatus,
    runtimeStatus: audit.runtimeStatus,
    sourceKind: audit.sourceKind,
    sourceCount: audit.sources.length,
    sourceUrls: audit.sources.map((source) => source.sourceUrl),
    productCount: audit.candidates.length,
    references,
    languages,
    availabilities,
    productsWithPrice: audit.candidates.filter((candidate) => Boolean(candidate.priceText)).length,
    productsWithImage: audit.candidates.filter((candidate) => Boolean(candidate.imageUrl)).length,
    commerciallyEligibleProducts: audit.candidates.filter((candidate) => candidate.commercialEligible === true).length,
    requiredSeller: connector?.requiredSellerLabel ?? null,
    sellerConfirmedProducts: connector?.requiredSellerPatterns?.length
      ? audit.candidates.filter((candidate) => candidate.commercialEligible === true).length
      : null,
    latencyMs: audit.sources.reduce((total, source) => total + source.durationMs, 0),
    errors: audit.sources.flatMap((source) => source.error ? [source.error] : []),
    fastWatchCapable: audit.fastWatchCapable === true,
    discoveryCapable: audit.discoveryCapable === true,
    commercialEligible: audit.commercialEligible === true,
    notes: audit.notes
  };
});

const report = {
  mode: "SAFE_PREVIEW_READ_ONLY_AUDIT",
  checkedAt: new Date().toISOString(),
  expectedStores: CONNECTORS.length,
  auditedStores: summaries.length,
  healthyStores: summaries.filter((store) => store.runtimeStatus === "healthy").length,
  degradedStores: summaries.filter((store) => store.runtimeStatus === "degraded").length,
  pendingStores: summaries.filter((store) => store.runtimeStatus === "pending").length,
  stores: summaries
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (serialized.includes(auditToken)) {
  throw new Error("Le rapport contiendrait le jeton d'audit : écriture refusée.");
}
if (/https?:\/\/[^\s\"]+authorized[_-]feed/i.test(serialized)) {
  throw new Error("Le rapport semble contenir une URL de flux autorisé : écriture refusée.");
}
if (summaries.length !== 21 || new Set(summaries.map((store) => store.store)).size !== 21) {
  throw new Error(`Audit incomplet: ${summaries.length}/21 boutique(s).`);
}

await writeFile("audit-report.json", serialized, "utf8");
if (requestFailures.length > 0) {
  throw new Error(
    `Audit Preview incomplet: ${requestFailures.length} requête(s) boutique ont échoué. ` +
    "Le rapport dégradé a été écrit pour diagnostic."
  );
}
console.log(JSON.stringify({
  auditedStores: report.auditedStores,
  healthyStores: report.healthyStores,
  degradedStores: report.degradedStores,
  pendingStores: report.pendingStores
}, null, 2));
