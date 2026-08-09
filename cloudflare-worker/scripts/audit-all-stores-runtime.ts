import { writeFile } from "node:fs/promises";

const baseUrl = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!baseUrl) throw new Error("PREVIEW_URL est obligatoire.");

const stores = [
  "maxireves", "oupi", "pixelheart", "fantasy-sphere", "ludisphere", "parkage",
  "ultrajeux", "playin", "philibert", "cultura", "micromania", "fnac", "leclerc",
  "carrefour", "king-jouet", "joueclub", "amazon-fr", "mystic-ambre", "ludiworld",
  "vegastore", "otakuland"
];

interface StoreSummary {
  store: string;
  endpointStatus?: number;
  durationMs: number;
  configuredSources: number;
  healthySources: number;
  failedSources: Array<{ url: string; error?: string; status?: number }>;
  candidates: number;
  frCandidates: number;
  actionableCandidates: number;
  errors: string[];
}

async function waitForAuditDeployment(): Promise<void> {
  let lastState = "aucune réponse";
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`, {
        headers: { "User-Agent": "OPWatchRuntimeAudit/1.0" },
        signal: AbortSignal.timeout(10_000)
      });
      const data = response.ok ? await response.json() as any : undefined;
      const publicAudit = data?.runtime?.publicStorePollingEnabled === true;
      const allowedStores = Array.isArray(data?.usage?.allowedStores) ? data.usage.allowedStores : [];
      const allStoresPresent = stores.every((store) => allowedStores.includes(store));
      lastState = `HTTP ${response.status}, publicAudit=${publicAudit}, stores=${allowedStores.length}`;
      if (response.ok && publicAudit && allStoresPresent) {
        console.log(`Déploiement audit propagé après ${attempt} tentative(s): ${lastState}`);
        return;
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 15) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Le déploiement SAFE audit n'a pas été observé après propagation: ${lastState}`);
}

await waitForAuditDeployment();

const summaries: StoreSummary[] = [];

for (const store of stores) {
  const started = Date.now();
  const summary: StoreSummary = {
    store,
    durationMs: 0,
    configuredSources: 0,
    healthySources: 0,
    failedSources: [],
    candidates: 0,
    frCandidates: 0,
    actionableCandidates: 0,
    errors: []
  };

  try {
    const response = await fetch(`${baseUrl}/audit?store=${encodeURIComponent(store)}`, {
      headers: { "User-Agent": "OPWatchRuntimeAudit/1.0" },
      signal: AbortSignal.timeout(120_000)
    });
    summary.endpointStatus = response.status;
    if (!response.ok) {
      summary.errors.push(`Audit endpoint HTTP ${response.status}`);
    } else {
      const data = await response.json() as any;
      const audit = data?.stores?.[0];
      if (!audit || audit.store !== store) {
        summary.errors.push("Réponse d'audit absente ou incohérente.");
      } else {
        const sources = Array.isArray(audit.sources) ? audit.sources : [];
        const candidates = Array.isArray(audit.candidates) ? audit.candidates : [];
        summary.configuredSources = sources.length;
        summary.healthySources = sources.filter((source: any) => !source.error && source.status === 200).length;
        summary.failedSources = sources
          .filter((source: any) => source.error || source.status !== 200)
          .map((source: any) => ({ url: source.sourceUrl, error: source.error, status: source.status }));
        summary.candidates = candidates.length;
        summary.frCandidates = candidates.filter((candidate: any) => candidate.language === "Français confirmé").length;
        summary.actionableCandidates = candidates.filter((candidate: any) =>
          candidate.language === "Français confirmé" &&
          ["available", "preorder"].includes(candidate.availability) &&
          candidate.commercialEligible !== false
        ).length;
      }
    }
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  summary.durationMs = Date.now() - started;
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}

const report = {
  mode: "SAFE_RUNTIME_AUDIT_21",
  checkedAt: new Date().toISOString(),
  storeCount: stores.length,
  endpointHealthy: summaries.filter((item) => item.endpointStatus === 200).length,
  sourceFullyHealthy: summaries.filter((item) => item.configuredSources > 0 && item.failedSources.length === 0).length,
  degraded: summaries.filter((item) => item.failedSources.length > 0 || item.errors.length > 0).map((item) => item.store),
  zeroCandidateStores: summaries.filter((item) => item.candidates === 0).map((item) => item.store),
  stores: summaries
};

await writeFile("all-stores-runtime-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

if (report.endpointHealthy < 15) {
  throw new Error(`Trop peu de boutiques auditées via Worker: ${report.endpointHealthy}/21`);
}
