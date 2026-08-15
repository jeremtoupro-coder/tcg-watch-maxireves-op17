import { writeFile } from "node:fs/promises";
import {
  CADENCE_SAMPLE_CYCLES,
  projectCadenceBudget,
  type DurableCycleResult
} from "../src/durableMonitoring";

const baseUrl = process.env.RUNTIME_TEST_URL?.replace(/\/$/, "");
const token = process.env.PREVIEW_AUDIT_TOKEN?.trim();
if (!baseUrl || !token) throw new Error("RUNTIME_TEST_URL et PREVIEW_AUDIT_TOKEN sont obligatoires.");

function compactDiagnostic(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isTransientPlatformError(message: string): boolean {
  return /Durable Object reset because its code was updated/i.test(message) ||
    /Durable Object.*reset/i.test(message) ||
    /internal error.*Durable Object/i.test(message) ||
    // Pendant quelques secondes après un déploiement, un DO peut encore
    // répondre avec la forme de payload de la version précédente. On rejoue le
    // même cycle, mais seulement dans la limite des 4 tentatives existantes :
    // une incompatibilité persistante reste donc un échec dur.
    /Cannot read properties of undefined \(reading '[^']+'\)/i.test(message);
}

async function waitForRuntime(): Promise<void> {
  let consecutive = 0;
  let lastDiagnostic = "aucune réponse";

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const url = new URL(`${baseUrl}/runtime-test`);
    url.searchParams.set("probe", "auth");
    url.searchParams.set("nonce", `${Date.now()}-${attempt}`);
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` }
      });
      const raw = await response.text();
      let body: {
        status?: string;
        mode?: string;
        schedulerMode?: string;
        discordMode?: string;
        productionStateWrites?: boolean;
      } | undefined;
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        body = undefined;
      }

      const ready = response.status === 200 &&
        body?.status === "ready" &&
        body.mode === "test" &&
        body.schedulerMode === "disabled" &&
        body.discordMode === "dry-run" &&
        body.productionStateWrites === false;

      if (ready) {
        consecutive += 1;
        lastDiagnostic = `runtime sûr ${consecutive}/4`;
      } else {
        consecutive = 0;
        lastDiagnostic = `HTTP ${response.status} ${body ? "JSON incohérent" : `non-JSON: ${compactDiagnostic(raw)}`}`;
      }
    } catch (error) {
      consecutive = 0;
      lastDiagnostic = error instanceof Error ? error.message : String(error);
    }

    if (consecutive >= 4) {
      console.log(`runtime-stable attempts=${attempt}`);
      return;
    }
    if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Runtime test non stabilisé: ${lastDiagnostic}`);
}

async function runCycle(time: number, discovery: boolean): Promise<DurableCycleResult> {
  const url = new URL(`${baseUrl}/runtime-test`);
  url.searchParams.set("time", String(time));
  if (discovery) url.searchParams.set("discovery", "true");

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` }
    });
    const raw = await response.text();
    let payload: (DurableCycleResult & { error?: string }) | undefined;
    try {
      payload = JSON.parse(raw) as DurableCycleResult & { error?: string };
    } catch {
      payload = undefined;
    }

    if (!payload) {
      lastError = new Error(
        `Runtime test HTTP ${response.status} non-JSON ` +
        `(${response.headers.get("content-type") ?? "type inconnu"}): ${compactDiagnostic(raw)}`
      );
      if (response.status >= 500 && attempt < 4) {
        console.warn(`[smoke-runtime] réponse plateforme transitoire ${attempt}/4: HTTP ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const message = payload.error ?? `Runtime test HTTP ${response.status}: ${compactDiagnostic(raw)}`;
      lastError = new Error(message);
      if (response.status >= 500 && isTransientPlatformError(message) && attempt < 4) {
        console.warn(`[smoke-runtime] propagation/reset DO ${attempt}/4; même cycle rejoué: ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        continue;
      }
      throw lastError;
    }

    const hardStoreFailures = payload.stores.filter((store) =>
      store.status === "error" || store.status === "overlap"
    );
    if (hardStoreFailures.length > 0) {
      const transientResets = hardStoreFailures.every((store) =>
        store.status === "error" && isTransientPlatformError(store.error ?? "")
      );
      const diagnostic = hardStoreFailures
        .map((store) => `${store.store}:${store.status}:${store.error ?? "sans détail"}`)
        .join(" | ");
      lastError = new Error(`Cycle avec échec Durable Object: ${diagnostic}`);
      if (transientResets && attempt < 4) {
        console.warn(`[smoke-runtime] reset DO interne ${attempt}/4; cycle entier rejoué.`);
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        continue;
      }
      throw lastError;
    }

    return payload;
  }

  throw lastError ?? new Error("Runtime test sans réponse exploitable.");
}

await waitForRuntime();

const quarterHour = 15 * 60_000;
const minute = 60_000;
const baseTime = Math.floor(Date.now() / quarterHour) * quarterHour;
const cycles: DurableCycleResult[] = [];

for (let index = 0; index < CADENCE_SAMPLE_CYCLES; index += 1) {
  const cycle = await runCycle(baseTime + index * minute, index === 0);
  if (cycle.mode !== "test") throw new Error(`Cycle ${index + 1}: mode inattendu ${cycle.mode}.`);
  if (index === 0 && !cycle.discovery) throw new Error("Le premier cycle doit être une Discovery réelle.");
  if (index > 0 && cycle.discovery) throw new Error(`Cycle ${index + 1}: Discovery inattendue.`);

  for (const store of cycle.stores) {
    const discordMode = store.result?.evaluation?.discordDispatch.mode;
    if (discordMode && discordMode !== "dry-run") {
      throw new Error(`Discord non dry-run détecté pour ${store.store}.`);
    }
    const allDiscordMode = store.result?.allEvaluation?.discordDispatch.mode;
    if (allDiscordMode && allDiscordMode !== "dry-run") {
      throw new Error(`Discord ONE PIECE ALL non dry-run détecté pour ${store.store}.`);
    }
  }
  cycles.push(cycle);
  console.log(
    `cycle=${index + 1}/${CADENCE_SAMPLE_CYCLES} discovery=${cycle.discovery} ` +
    `stores=${cycle.stores.length} wallMs=${cycle.wallDurationMs} durableMs=${cycle.durableDurationMs} doRequests=${cycle.durableRequestCount}`
  );
}

const budget = projectCadenceBudget(cycles);
const incidentCycles = cycles.flatMap((cycle, index) => cycle.stores
  .filter((store) => store.status !== "completed")
  .map((store) => ({ cycle: index + 1, store: store.store, status: store.status, error: store.error }))
);
const incidentStores = [...new Set(incidentCycles.map((entry) => entry.store))].sort();
const authorizedFeedSources = cycles.flatMap((cycle, cycleIndex) => cycle.stores.flatMap((store) =>
  (store.result?.audits ?? []).flatMap((audit) => audit.sources
    .filter((source) => source.sourceUrl.startsWith("authorized-feed:"))
    .map((source) => ({
      cycle: cycleIndex + 1,
      store: store.store,
      status: source.status,
      responseBytes: source.responseBytes ?? 0,
      cacheValidation: source.cacheValidation ?? "none",
      notModified: source.notModified === true,
      error: source.error
    })))
));
const report = {
  generatedAt: new Date().toISOString(),
  environment: "isolated-runtime-test",
  discordMode: "dry-run",
  schedulerMode: "disabled",
  productionStateWrites: false,
  cycles: cycles.map((cycle, index) => ({
    index: index + 1,
    scheduledTime: new Date(cycle.scheduledTime).toISOString(),
    discovery: cycle.discovery,
    wallDurationMs: cycle.wallDurationMs,
    durableDurationMs: cycle.durableDurationMs,
    durableRequestCount: cycle.durableRequestCount,
    pendingAuthorizedFeedStores: cycle.pendingAuthorizedFeedStores,
    deferredDiscoveryStores: cycle.deferredDiscoveryStores,
    stores: cycle.stores.map((store) => ({
      store: store.store,
      status: store.status,
      durationMs: store.durationMs,
      merchantDurationMs: store.merchantDurationMs,
      backoffUntil: store.backoffUntil,
      error: store.error,
      degradedStores: store.result?.degradedStores ?? [],
      sources: (store.result?.audits ?? []).flatMap((audit) => audit.sources.map((source) => ({
        source: source.sourceUrl,
        status: source.status,
        responseBytes: source.responseBytes ?? 0,
        cacheValidation: source.cacheValidation,
        notModified: source.notModified === true,
        durationMs: source.durationMs,
        error: source.error
      })))
    }))
  })),
  authorizedFeeds: {
    checks: authorizedFeedSources.length,
    fullResponses: authorizedFeedSources.filter((source) => source.status === 200).length,
    notModifiedResponses: authorizedFeedSources.filter((source) => source.notModified).length,
    responseBytes: authorizedFeedSources.reduce((total, source) => total + source.responseBytes, 0),
    validators: Object.fromEntries([...new Set(authorizedFeedSources.map((source) => source.cacheValidation))]
      .sort()
      .map((kind) => [kind, authorizedFeedSources.filter((source) => source.cacheValidation === kind).length])),
    sources: authorizedFeedSources
  },
  budget,
  operational: {
    pass: incidentCycles.length === 0,
    incidentStores,
    incidentCycles
  },
  budgetVerdict: budget.pass ? "PASS" : "FAIL",
  verdict: budget.pass && incidentCycles.length === 0
    ? "PASS"
    : budget.pass
      ? "PASS_BUDGET_WITH_STORE_INCIDENTS"
      : "FAIL"
};

await writeFile("runtime-cadence-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ verdict: report.verdict, budget }, null, 2));

if (!budget.pass) {
  throw new Error(
    `Budget Cloudflare refusé: ${budget.projectedGbSecondsPerDay.toFixed(2)} GB-s/j, ` +
    `${budget.projectedDurableRequestsPerDay} requêtes DO/j.`
  );
}
