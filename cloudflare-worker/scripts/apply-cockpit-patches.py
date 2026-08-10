from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    return (ROOT / path).read_text()

def save(path, text):
    (ROOT / path).write_text(text)

def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, got {count}")
    return text.replace(old, new, 1)

def sub_once(text, pattern, replacement, label, flags=0):
    out, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex occurrence, got {count}")
    return out

# ---- opwatchV1.ts: dynamic languages + manual generic products ----
p = "src/opwatchV1.ts"
t = load(p)
t = once(t,
    'import type { ProductCandidate, ProductFormat, WatchConfig } from "./types";',
    'import type { LanguageStatus, ProductCandidate, ProductFormat, WatchConfig } from "./types";',
    "opwatch import")

t = sub_once(t,
    r'export function listingIdentity\(\n  store: string,\n  productId: string,\n  format: ProductFormat,\n  discriminator = ""\n\): string \{\n  const stablePart = normalizedIdentityDiscriminator\(discriminator\);\n  return `\$\{store\.trim\(\)\.toLowerCase\(\)\}\|\$\{productId\}\|\$\{format\}\|fr\$\{stablePart \? `\|\$\{stablePart\}` : ""\}`;\n\}',
    '''function identityLanguageKey(language: LanguageStatus): string {
  if (language === "Anglais détecté") return "en";
  if (language === "Japonais détecté") return "jp";
  if (language === "Français confirmé") return "fr";
  return "other";
}

export function listingIdentity(
  store: string,
  productId: string,
  format: ProductFormat,
  discriminator = "",
  language: LanguageStatus = "Français confirmé"
): string {
  const stablePart = normalizedIdentityDiscriminator(discriminator);
  return `${store.trim().toLowerCase()}|${productId}|${format}|${identityLanguageKey(language)}${stablePart ? `|${stablePart}` : ""}`;
}''',
    "listing identity")

t = once(t,
    'listingIdentity(candidate.store, reference, format, discriminator)',
    'listingIdentity(candidate.store, reference, format, discriminator, candidate.language)',
    "enrich identity language")

t = once(t,
    '''export function candidateForActiveProducts(
  candidate: ProductCandidate,
  activeProducts: OfficialProduct[]
): ProductCandidate | undefined {''',
    '''export function candidateForActiveProducts(
  candidate: ProductCandidate,
  activeProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[] = ["Français confirmé"]
): ProductCandidate | undefined {''',
    "candidate signature")

t = once(t,
    '''  if (activeReferences.length !== 1) return undefined;
  if (!enriched.format || enriched.format === "other") return undefined;
  if (enriched.language !== "Français confirmé") return undefined;''',
    '''  if (activeReferences.length !== 1) return undefined;
  const matchedProduct = activeProducts.find((product) => product.id === activeReferences[0]);
  if (!enriched.format) return undefined;
  if (enriched.format === "other" && matchedProduct?.family !== "OTHER") return undefined;
  if (!acceptedLanguages.includes(enriched.language)) return undefined;''',
    "candidate gates")

t = once(t,
    '''      enriched.externalId || enriched.title
    )''',
    '''      enriched.externalId || enriched.title,
      enriched.language
    )''',
    "candidate identity output")

t = once(t,
    'export function buildActiveWatchConfig(products: OfficialProduct[]): WatchConfig {',
    'export function buildActiveWatchConfig(products: OfficialProduct[], acceptedLanguages: LanguageStatus[] = ["Français confirmé"]): WatchConfig {',
    "watch config signature")
t = once(t, 'defaultLanguages: ["Français confirmé"]', 'defaultLanguages: acceptedLanguages', "watch default languages")
t = t.replace('languages: ["Français confirmé"]', 'languages: acceptedLanguages')
save(p, t)

# ---- audit.ts: aliases from active/manual products can create candidates ----
p = "src/audit.ts"
t = load(p)
t = once(t,
    'import { decodeHtml, detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";',
    'import { decodeHtml, detectAvailability, detectLanguage, extractPrice, matchReferences, normalizeForMatching, stripHtml } from "./matching";',
    "audit matching import")
t = once(t,
    'import { enrichCandidateIdentity, extractProductImage } from "./opwatchV1";',
    'import { enrichCandidateIdentity, extractProductImage, type OfficialProduct } from "./opwatchV1";',
    "audit product import")

anchor = '''function languageFromPrimary(primary: string, fallback: string): LanguageStatus {
  const primaryLanguage = detectLanguage(primary);
  return primaryLanguage === "Langue non précisée" ? detectLanguage(fallback) : primaryLanguage;
}
'''
helper = anchor + '''
function matchWatchReferences(value: string, watchProducts: OfficialProduct[]): string[] {
  const matches = new Set(matchReferences(value));
  const normalized = normalizeForMatching(value);
  for (const product of watchProducts) {
    if (product.aliases.some((alias) => {
      const candidate = normalizeForMatching(alias);
      return candidate.length >= 3 && normalized.includes(candidate);
    })) {
      matches.add(product.id);
    }
  }
  return [...matches];
}
'''
t = once(t, anchor, helper, "audit alias helper")

t = once(t,
    '''function extractDirectProductCandidate(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): ProductCandidate | undefined {''',
    '''function extractDirectProductCandidate(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[]
): ProductCandidate | undefined {''',
    "direct signature")
t = once(t,
    'const matchedReferences = matchReferences(`${title} ${productUrl} ${sourceUrl}`);',
    'const matchedReferences = matchWatchReferences(`${title} ${productUrl} ${sourceUrl}`, watchProducts);',
    "direct reference matcher")
t = once(t,
    '''function extractCandidates(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition
): { candidates: ProductCandidate[]; productLinksSeen: number } {''',
    '''function extractCandidates(
  html: string,
  sourceUrl: string,
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[]
): { candidates: ProductCandidate[]; productLinksSeen: number } {''',
    "candidate extractor signature")
t = once(t,
    'const directCandidate = extractDirectProductCandidate(html, sourceUrl, connector);',
    'const directCandidate = extractDirectProductCandidate(html, sourceUrl, connector, watchProducts);',
    "direct matcher call")
t = once(t,
    'let matchedReferences = matchReferences(`${metadata} ${absoluteUrl} ${resolvedUrl}`);',
    'let matchedReferences = matchWatchReferences(`${metadata} ${absoluteUrl} ${resolvedUrl}`, watchProducts);',
    "anchor matcher")
t = once(t,
    'matchedReferences = matchReferences(`${heading} ${absoluteUrl}`);',
    'matchedReferences = matchWatchReferences(`${heading} ${absoluteUrl}`, watchProducts);',
    "heading matcher")
t = once(t,
    'async function fetchSource(sourceUrl: string, connector: ConnectorDefinition): Promise<SourceAudit> {',
    'async function fetchSource(sourceUrl: string, connector: ConnectorDefinition, watchProducts: OfficialProduct[]): Promise<SourceAudit> {',
    "fetch source signature")
t = once(t,
    'const extracted = extractCandidates(html, response.url || sourceUrl, connector);',
    'const extracted = extractCandidates(html, response.url || sourceUrl, connector, watchProducts);',
    "extract candidates call")
t = once(t,
    '''async function fetchSourcesInBatches(
  sourceUrls: string[],
  connector: ConnectorDefinition,
  concurrency: number
): Promise<SourceAudit[]> {''',
    '''async function fetchSourcesInBatches(
  sourceUrls: string[],
  connector: ConnectorDefinition,
  concurrency: number,
  watchProducts: OfficialProduct[]
): Promise<SourceAudit[]> {''',
    "batch signature")
t = once(t,
    'batch.map((sourceUrl) => fetchSource(sourceUrl, connector))',
    'batch.map((sourceUrl) => fetchSource(sourceUrl, connector, watchProducts))',
    "batch fetch call")
t = once(t,
    'export async function auditConnector(connector: ConnectorDefinition): Promise<StoreAudit> {',
    'export async function auditConnector(connector: ConnectorDefinition, watchProducts: OfficialProduct[] = []): Promise<StoreAudit> {',
    "audit connector signature")
t = t.replace('fetchSourcesInBatches(initialSources, connector, concurrency)', 'fetchSourcesInBatches(initialSources, connector, concurrency, watchProducts)')
t = t.replace('fetchSourcesInBatches(productUrls, connector, concurrency)', 'fetchSourcesInBatches(productUrls, connector, concurrency, watchProducts)')
save(p, t)

# ---- storeAudit.ts ----
p = "src/storeAudit.ts"
t = load(p)
t = once(t, 'import { auditParkagePublicCatalog } from "./parkagePublicCatalog";', 'import { auditParkagePublicCatalog } from "./parkagePublicCatalog";\nimport type { OfficialProduct } from "./opwatchV1";', "store audit import")
t = once(t,
    '''export async function auditStore(connector: ConnectorDefinition, env: Env): Promise<StoreAudit> {''',
    '''export async function auditStore(connector: ConnectorDefinition, env: Env, watchProducts: OfficialProduct[] = []): Promise<StoreAudit> {''',
    "store audit signature")
t = once(t, 'await auditConnector(connector)', 'await auditConnector(connector, watchProducts)', "store audit connector call")
save(p, t)

# ---- monitor.ts ----
p = "src/monitor.ts"
t = load(p)
t = once(t, 'import type { Env, StoreAudit, StoreKey } from "./types";', 'import type { Env, LanguageStatus, StoreAudit, StoreKey } from "./types";', "monitor type import")
t = once(t,
    '''  options: {
    scheduledTime?: number;
    forceStore?: StoreKey;
    forceDiscovery?: boolean;
    officialProducts?: OfficialProduct[];
    stateStore?: StateStore;
    now?: Date;
  } = {}''',
    '''  options: {
    scheduledTime?: number;
    forceStore?: StoreKey;
    forceDiscovery?: boolean;
    officialProducts?: OfficialProduct[];
    acceptedLanguages?: LanguageStatus[];
    extraSourcesByStore?: Partial<Record<StoreKey, string[]>>;
    stateStore?: StateStore;
    now?: Date;
  } = {}''',
    "monitor options")
t = once(t,
    '  const requestedConnectors = selectConnectors(activeStores);',
    '''  const requestedConnectors = selectConnectors(activeStores).map((connector) => {
    const extras = options.extraSourcesByStore?.[connector.key] ?? [];
    if (extras.length === 0 || connector.directPollingDisabledWithoutFeed === true) return connector;
    return { ...connector, sources: [...new Set([...connector.sources, ...extras])] };
  });
  const acceptedLanguages = options.acceptedLanguages?.length
    ? [...new Set(options.acceptedLanguages)]
    : ["Français confirmé" as LanguageStatus];''',
    "monitor dynamic connectors")
t = once(t, 'const dynamicConfig = buildActiveWatchConfig(officialProducts);', 'const dynamicConfig = buildActiveWatchConfig(officialProducts, acceptedLanguages);', "monitor dynamic config")
t = once(t, 'const audits = await Promise.all(connectors.map((connector) => auditStore(connector, env)));', 'const audits = await Promise.all(connectors.map((connector) => auditStore(connector, env, officialProducts)));', "monitor audits")
# discovery cache signature + qualification
old_sig = '''async function persistDiscoveryCache(
  audit: StoreAudit,
  connector: ReturnType<typeof selectConnectors>[number],
  stateStore: StateStore,
  officialProducts: OfficialProduct[],
  discoveredAt: string
): Promise<void> {'''
new_sig = '''async function persistDiscoveryCache(
  audit: StoreAudit,
  connector: ReturnType<typeof selectConnectors>[number],
  stateStore: StateStore,
  officialProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[],
  discoveredAt: string
): Promise<void> {'''
t = once(t, old_sig, new_sig, "discovery cache signature")
t = once(t, 'const qualified = candidateForActiveProducts(candidate, officialProducts);', 'const qualified = candidateForActiveProducts(candidate, officialProducts, acceptedLanguages);', "discovery qualification")
t = once(t,
    '''        await persistDiscoveryCache(audit, connector, stateStore, officialProducts, discoveredAt);''',
    '''        await persistDiscoveryCache(audit, connector, stateStore, officialProducts, acceptedLanguages, discoveredAt);''',
    "discovery cache call")
t = once(t,
    '      .map((candidate) => candidateForActiveProducts(candidate, officialProducts))',
    '      .map((candidate) => candidateForActiveProducts(candidate, officialProducts, acceptedLanguages))',
    "candidate active filter")
save(p, t)

# ---- durableMonitoring.ts ----
p = "src/durableMonitoring.ts"
t = load(p)
t = once(t, 'import { loadOfficialCalendar } from "./officialCalendar";', 'import { loadOfficialCalendar } from "./officialCalendar";\nimport { CONTROL_CONFIG_STORAGE_KEY, applyRuntimeControlConfig, defaultRuntimeControlConfig, extraStoreSources, normalizeRuntimeControlConfig, type RuntimeControlConfig } from "./controlPlane";', "durable control import")
t = once(t, 'import type { Env, ProductSnapshot, StoreKey } from "./types";', 'import type { Env, LanguageStatus, ProductSnapshot, StoreKey } from "./types";', "durable type import")

# health interface after DurableCycleStoreResult
needle = '''export interface DurableCycleStoreResult {
  store: StoreKey;
  status: "completed" | "degraded" | "backoff" | "overlap" | "error";
  durationMs: number;
  merchantDurationMs: number;
  backoffUntil?: string;
  result?: Awaited<ReturnType<typeof runMonitoringCycle>>;
  error?: string;
}
'''
insert = needle + '''
export interface StoreRuntimeHealth {
  store: StoreKey;
  status: DurableCycleStoreResult["status"];
  checkedAt: string;
  completedAt: string;
  durationMs: number;
  merchantDurationMs: number;
  candidates: number;
  sourceKind?: string;
  error?: string;
  backoffUntil?: string;
  discovery: boolean;
}
'''
t = once(t, needle, insert, "health interface")

# durable prune language
old_sig = '''async function pruneFastWatchCache(
  stateStore: StateStore,
  store: StoreKey,
  officialProducts: OfficialProduct[],
  result: Awaited<ReturnType<typeof runMonitoringCycle>>,
  discoveredAt: string
): Promise<void> {'''
new_sig = '''async function pruneFastWatchCache(
  stateStore: StateStore,
  store: StoreKey,
  officialProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[],
  result: Awaited<ReturnType<typeof runMonitoringCycle>>,
  discoveredAt: string
): Promise<void> {'''
t = once(t, old_sig, new_sig, "durable prune signature")
t = once(t, 'const qualified = candidateForActiveProducts(candidate, officialProducts);', 'const qualified = candidateForActiveProducts(candidate, officialProducts, acceptedLanguages);', "durable prune qualification")

# Store DO entry routes
old = '''  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/run") {
      return json({ error: "Route Durable Object boutique invalide." }, 404);
    }
    if (this.running) {
      return json({ status: "overlap", durationMs: 0, merchantDurationMs: 0 }, 409);
    }

    const started = performance.now();
    this.running = true;
    try {
      const input = await request.json() as {
        store?: StoreKey;
        scheduledTime?: number;
        forceDiscovery?: boolean;
        officialProducts?: OfficialProduct[];
      };
      const store = input.store;'''
new = '''  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      return json({ health: await this.state.storage.get<StoreRuntimeHealth>("runtime:health") });
    }
    if (request.method === "POST" && pathname === "/invalidate") {
      await this.state.storage.put("metadata:monitor:last-discovery", "1970-01-01T00:00:00.000Z");
      return json({ status: "invalidated" });
    }
    if (request.method !== "POST" || pathname !== "/run") {
      return json({ error: "Route Durable Object boutique invalide." }, 404);
    }
    if (this.running) {
      return json({ status: "overlap", durationMs: 0, merchantDurationMs: 0 }, 409);
    }

    const started = performance.now();
    let activeStore: StoreKey | undefined;
    let activeScheduledTime = Date.now();
    let activeDiscovery = false;
    this.running = true;
    try {
      const input = await request.json() as {
        store?: StoreKey;
        scheduledTime?: number;
        forceDiscovery?: boolean;
        officialProducts?: OfficialProduct[];
        acceptedLanguages?: LanguageStatus[];
        extraStoreSources?: string[];
      };
      const store = input.store;
      activeStore = store;
      activeScheduledTime = Number(input.scheduledTime) || Date.now();
      activeDiscovery = input.forceDiscovery === true;'''
t = once(t, old, new, "store DO routes")

# backoff save
old = '''      if (Number.isFinite(backoffUntil) && (scheduledTime as number) < backoffUntil && input.forceDiscovery !== true) {
        return json({
          status: "backoff",
          durationMs: Math.round(performance.now() - started),
          merchantDurationMs: 0,
          backoffUntil: new Date(backoffUntil).toISOString()
        });
      }'''
new = '''      if (Number.isFinite(backoffUntil) && (scheduledTime as number) < backoffUntil && input.forceDiscovery !== true) {
        const durationMs = Math.round(performance.now() - started);
        const health: StoreRuntimeHealth = {
          store,
          status: "backoff",
          checkedAt: new Date(scheduledTime as number).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          merchantDurationMs: 0,
          candidates: 0,
          backoffUntil: new Date(backoffUntil).toISOString(),
          discovery: false
        };
        await this.state.storage.put("runtime:health", health);
        return json({ status: "backoff", durationMs, merchantDurationMs: 0, backoffUntil: health.backoffUntil });
      }'''
t = once(t, old, new, "backoff health")

# run monitoring options
old = '''      const result = await runMonitoringCycle(storeEnv, {
        scheduledTime: scheduledTime as number,
        officialProducts: input.officialProducts,
        stateStore,
        now: new Date(scheduledTime as number)
      });'''
new = '''      const acceptedLanguages = input.acceptedLanguages?.length ? input.acceptedLanguages : ["Français confirmé" as LanguageStatus];
      const result = await runMonitoringCycle(storeEnv, {
        scheduledTime: scheduledTime as number,
        officialProducts: input.officialProducts,
        acceptedLanguages,
        extraSourcesByStore: input.extraStoreSources?.length ? { [store]: input.extraStoreSources } : undefined,
        stateStore,
        now: new Date(scheduledTime as number)
      });'''
t = once(t, old, new, "store monitoring options")

# prune call
old = '''          input.officialProducts,
          result,
          new Date(scheduledTime as number).toISOString()'''
new = '''          input.officialProducts,
          acceptedLanguages,
          result,
          new Date(scheduledTime as number).toISOString()'''
t = once(t, old, new, "durable prune call")

# success return with health
old = '''      return json({
        status: degraded ? "degraded" : "completed",
        durationMs: Math.round(performance.now() - started),
        merchantDurationMs: sourceDurationMs(result),
        result
      });'''
new = '''      const durationMs = Math.round(performance.now() - started);
      const merchantDurationMs = sourceDurationMs(result);
      const audit = result.audits?.find((entry) => entry.store === store);
      const error = result.degradedStores?.find((entry) => entry.store === store)?.errors.join(" | ");
      const health: StoreRuntimeHealth = {
        store,
        status: degraded ? "degraded" : "completed",
        checkedAt: new Date(scheduledTime as number).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        merchantDurationMs,
        candidates: audit?.candidates.length ?? 0,
        sourceKind: audit?.sourceKind,
        ...(error ? { error } : {}),
        discovery: input.forceDiscovery === true
      };
      await this.state.storage.put("runtime:health", health);
      return json({ status: health.status, durationMs, merchantDurationMs, result });'''
t = once(t, old, new, "success health")

# catch health
old = '''    } catch (error) {
      return json({
        status: "error",
        durationMs: Math.round(performance.now() - started),
        merchantDurationMs: 0,
        error: safeError(error)
      }, 500);'''
new = '''    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      const message = safeError(error);
      if (activeStore) {
        await this.state.storage.put("runtime:health", {
          store: activeStore,
          status: "error",
          checkedAt: new Date(activeScheduledTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          merchantDurationMs: 0,
          candidates: 0,
          error: message,
          discovery: activeDiscovery
        } satisfies StoreRuntimeHealth);
      }
      return json({ status: "error", durationMs, merchantDurationMs: 0, error: message }, 500);'''
t = once(t, old, new, "error health")

# Calendar DO routes
old = '''  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/calendar") {
      return json({ error: "Route Durable Object calendrier invalide." }, 404);
    }
    if (this.running) return this.running;'''
new = '''  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/control") {
      const raw = await this.state.storage.get<unknown>(CONTROL_CONFIG_STORAGE_KEY);
      return json(normalizeRuntimeControlConfig(raw));
    }
    if (request.method === "PUT" && pathname === "/control") {
      const raw = await request.json();
      const config = normalizeRuntimeControlConfig(raw);
      await this.state.storage.put(CONTROL_CONFIG_STORAGE_KEY, config);
      return json(config);
    }
    if (request.method !== "POST" || pathname !== "/calendar") {
      return json({ error: "Route Durable Object calendrier invalide." }, 404);
    }
    if (this.running) return this.running;'''
t = once(t, old, new, "calendar control routes")

# Calendar result
old = '''        return json({
          durationMs: Math.round(performance.now() - started),
          fetchedAt: calendar.fetchedAt,
          sourcePages: calendar.sourcePages,
          cache: calendar.cache,
          activeProducts: calendar.activeProducts
        });'''
new = '''        const rawControl = await this.state.storage.get<unknown>(CONTROL_CONFIG_STORAGE_KEY);
        const control = rawControl ? normalizeRuntimeControlConfig(rawControl) : defaultRuntimeControlConfig();
        const activeProducts = applyRuntimeControlConfig(calendar.activeProducts, control, new Date(scheduledTime));
        return json({
          durationMs: Math.round(performance.now() - started),
          fetchedAt: calendar.fetchedAt,
          sourcePages: calendar.sourcePages,
          cache: calendar.cache,
          activeProducts,
          acceptedLanguages: control.languages,
          extraSourcesByStore: extraStoreSources(control),
          controlUpdatedAt: control.updatedAt
        });'''
t = once(t, old, new, "calendar controlled result")

# getCalendar type
old = '''async function getCalendar(
  env: RuntimeEnv,
  prefix: string,
  scheduledTime: number
): Promise<{ durationMs: number; activeProducts: OfficialProduct[] }> {'''
new = '''async function getCalendar(
  env: RuntimeEnv,
  prefix: string,
  scheduledTime: number
): Promise<{
  durationMs: number;
  activeProducts: OfficialProduct[];
  acceptedLanguages: LanguageStatus[];
  extraSourcesByStore: Partial<Record<StoreKey, string[]>>;
}> {'''
t = once(t, old, new, "calendar result type")

# runStore signature + body
old = '''async function runStore(
  env: RuntimeEnv,
  prefix: string,
  store: StoreKey,
  scheduledTime: number,
  forceDiscovery: boolean,
  officialProducts: OfficialProduct[]
): Promise<DurableCycleStoreResult> {'''
new = '''async function runStore(
  env: RuntimeEnv,
  prefix: string,
  store: StoreKey,
  scheduledTime: number,
  forceDiscovery: boolean,
  officialProducts: OfficialProduct[],
  acceptedLanguages: LanguageStatus[],
  extraStoreSources: string[]
): Promise<DurableCycleStoreResult> {'''
t = once(t, old, new, "runStore signature")
t = once(t,
    'body: JSON.stringify({ store, scheduledTime, forceDiscovery, officialProducts })',
    'body: JSON.stringify({ store, scheduledTime, forceDiscovery, officialProducts, acceptedLanguages, extraStoreSources })',
    "runStore body")
# runStore call
old = '''      scheduledTime,
      selection.discovery,
      calendar.activeProducts
    ))));'''
new = '''      scheduledTime,
      selection.discovery,
      calendar.activeProducts,
      calendar.acceptedLanguages,
      calendar.extraSourcesByStore[store] ?? []
    ))));'''
t = once(t, old, new, "runStore call")
save(p, t)

# ---- runtimeEntry.ts ----
p = "src/runtimeEntry.ts"
t = load(p)
t = once(t, 'import { dispatchRuntimeHeartbeat } from "./heartbeat";', 'import { dispatchRuntimeHeartbeat } from "./heartbeat";\nimport { handleCockpitApi } from "./cockpitApi";', "runtime cockpit import")
t = once(t,
    '''    if (pathname === "/runtime-test") {
      return runtimeTest(request, env as RuntimeEnv);
    }''',
    '''    if (pathname.startsWith("/cockpit/api/")) {
      return handleCockpitApi(request, env as RuntimeEnv);
    }
    if (pathname === "/runtime-test") {
      return runtimeTest(request, env as RuntimeEnv);
    }''',
    "runtime cockpit route")
save(p, t)

print("Cockpit patches applied successfully")
