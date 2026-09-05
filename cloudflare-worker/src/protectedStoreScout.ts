import { CONNECTORS } from "./connectors";
import { dispatchDiscordPayloads } from "./discord";
import { loadOfficialCalendar } from "./officialCalendar";
import { hasCommercialSignal, hasFrenchSignal, matchedProductIds, selectScoutProducts } from "./webScout";
import type { StateStore } from "./state";
import type { DiscordPayload, Env, ProductSnapshot, StoreKey } from "./types";
import type { OfficialProduct } from "./opwatchV1";
import opWatchV1Config from "../config/opwatch-v1.json";

export const PROTECTED_STORE_SCOUT_MINUTE = 11;
export const PROTECTED_STORE_SCOUT_INTERVAL_HOURS = 3;
export const PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP = 248;
const MAX_ALERTS_PER_RUN = 3;
const BRAVE_TIMEOUT_MS = 15_000;

const PROTECTED_STORES: ReadonlyArray<{ key: StoreKey; domain: string }> = [
  { key: "playin", domain: "play-in.com" },
  { key: "cultura", domain: "cultura.com" },
  { key: "micromania", domain: "micromania.fr" },
  { key: "fnac", domain: "fnac.com" },
  { key: "carrefour", domain: "carrefour.fr" },
  { key: "king-jouet", domain: "king-jouet.com" }
];

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
}

interface ProtectedScoutEnv extends Env {
  BRAVE_SEARCH_API_KEY?: string;
  RUNTIME_TEST_MODE?: string;
}

interface ProtectedFinding {
  store: StoreKey;
  storeName: string;
  url: string;
  title: string;
  matchedProductIds: string[];
  snippet: string;
}

class ScoutStateStore implements StateStore {
  readonly mode = "memory" as const;
  readonly writable: boolean;

  constructor(private readonly storage: DurableObjectStorage, writable: boolean) {
    this.writable = writable;
  }

  async get(key: string): Promise<ProductSnapshot | undefined> {
    return this.storage.get<ProductSnapshot>(`protected-scout:product:${key}`);
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    if (this.writable) await this.storage.put(`protected-scout:product:${key}`, value);
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return this.storage.get<string>(`protected-scout:metadata:${key}`);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    if (this.writable) await this.storage.put(`protected-scout:metadata:${key}`, value);
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

function protectedStoreForUrl(rawUrl: string): { key: StoreKey; domain: string } | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    return PROTECTED_STORES.find((entry) => domainMatches(url.hostname, entry.domain));
  } catch {
    return undefined;
  }
}

function isConfiguredProductPage(store: StoreKey, rawUrl: string): boolean {
  const connector = CONNECTORS.find((entry) => entry.key === store);
  if (!connector) return false;
  return connector.productUrlPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    const matched = pattern.test(rawUrl);
    pattern.lastIndex = 0;
    return matched;
  });
}

function resultText(result: BraveWebResult): string {
  return [result.title, result.description, ...(result.extra_snippets ?? [])]
    .filter(Boolean)
    .join(" \n");
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function findingKey(finding: ProtectedFinding): string {
  return `protected-scout:seen:${fnv1a(`${finding.store}|${finding.url}|${finding.matchedProductIds.sort().join(",")}`)}`;
}

export function isProtectedStoreScoutTick(scheduledTime: number): boolean {
  const date = new Date(scheduledTime);
  return date.getUTCMinutes() === PROTECTED_STORE_SCOUT_MINUTE &&
    date.getUTCHours() % PROTECTED_STORE_SCOUT_INTERVAL_HOURS === 0;
}

export function buildProtectedStoreScoutQuery(products: OfficialProduct[]): string {
  const refs = products
    .slice(0, 6)
    .map((product) => `"${product.id}"`)
    .join(" OR ");
  const sites = PROTECTED_STORES.map((entry) => `site:${entry.domain}`).join(" OR ");
  return `(${refs}) "One Piece" (précommande OR "en stock" OR display OR booster) (${sites}) lang:fr`.slice(0, 400);
}

export function qualifyProtectedSearchResult(
  result: BraveWebResult,
  products: OfficialProduct[]
): ProtectedFinding | undefined {
  if (!result.url || !result.title) return undefined;
  const store = protectedStoreForUrl(result.url);
  if (!store || !isConfiguredProductPage(store.key, result.url)) return undefined;
  const text = resultText(result);
  const references = matchedProductIds(text, products);
  if (references.length === 0) return undefined;
  if (!/one[\s-]*piece/i.test(text)) return undefined;
  if (!hasCommercialSignal(text) || !hasFrenchSignal(text)) return undefined;
  const connector = CONNECTORS.find((entry) => entry.key === store.key);
  if (!connector) return undefined;
  return {
    store: store.key,
    storeName: connector.name,
    url: result.url,
    title: result.title,
    matchedProductIds: references,
    snippet: (result.description ?? result.extra_snippets?.[0] ?? "").slice(0, 900)
  };
}

function protectedScoutPayload(finding: ProtectedFinding, scheduledTime: number): DiscordPayload {
  const detected = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris"
  }).format(new Date(scheduledTime));
  return {
    username: "OP Watch",
    embeds: [{
      title: `🟠 PROTECTED SCOUT • fiche indexée — ${finding.matchedProductIds.join(", ")}`,
      url: finding.url,
      description: finding.title,
      fields: [
        { name: "🏪 Boutique", value: finding.storeName, inline: true },
        { name: "🎯 Référence", value: finding.matchedProductIds.join(", "), inline: true },
        { name: "⚠️ Niveau de preuve", value: "Fiche repérée dans l’index Brave. Disponibilité, prix et vendeur restent à vérifier sur la boutique.", inline: false },
        ...(finding.snippet ? [{ name: "🔎 Extrait indexé", value: finding.snippet, inline: false }] : []),
        { name: "🕒 Détecté", value: detected, inline: true },
        { name: "🔗 Fiche", value: `[Ouvrir la page](${finding.url})`, inline: false }
      ],
      footer: { text: "OP Watch • Protected Scout • aucune protection anti-bot contournée" },
      timestamp: new Date(scheduledTime).toISOString()
    }]
  };
}

function monthlyBudgetKey(scheduledTime: number): string {
  return `protected-scout:budget:${new Date(scheduledTime).toISOString().slice(0, 7)}`;
}

async function fetchBrave(apiKey: string, query: string): Promise<BraveWebResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("country", "FR");
  url.searchParams.set("search_lang", "fr");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("freshness", "pm");
  url.searchParams.set("extra_snippets", "true");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Brave HTTP ${response.status}`);
    const data = await response.json() as { web?: { results?: BraveWebResult[] } };
    return data.web?.results ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export class ProtectedStoreScoutDurableObject {
  private running?: Promise<Response>;

  constructor(private readonly state: DurableObjectState, private readonly env: ProtectedScoutEnv) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      return new Response(JSON.stringify({ health: await this.state.storage.get("protected-scout:health") }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }
    if (request.method !== "POST" || pathname !== "/run") {
      return new Response(JSON.stringify({ error: "Route Protected Scout invalide." }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
    if (this.running) return this.running;
    this.running = this.run(request);
    try {
      return await this.running;
    } finally {
      this.running = undefined;
    }
  }

  private async run(request: Request): Promise<Response> {
    let scheduledTime = Date.now();
    try {
      const input = await request.json() as { scheduledTime?: number };
      scheduledTime = Number(input.scheduledTime);
      if (!Number.isFinite(scheduledTime)) throw new Error("scheduledTime invalide");
      const checkedAt = new Date(scheduledTime).toISOString();
      const apiKey = this.env.BRAVE_SEARCH_API_KEY?.trim();
      if (!apiKey || this.env.RUNTIME_TEST_MODE === "true") {
        const health = {
          status: "disabled",
          checkedAt,
          alerted: 0,
          error: apiKey ? "Protected Scout désactivé en runtime test." : "BRAVE_SEARCH_API_KEY absent."
        };
        await this.state.storage.put("protected-scout:health", health);
        return Response.json(health);
      }

      const stateStore = new ScoutStateStore(this.state.storage, this.env.WRITE_STATE === "true");
      const calendar = await loadOfficialCalendar({
        sourceUrl: opWatchV1Config.officialCatalogUrl,
        now: new Date(scheduledTime),
        daysBefore: opWatchV1Config.watchWindow.daysBeforeRelease,
        daysAfter: opWatchV1Config.watchWindow.daysAfterRelease,
        stateStore
      });
      const products = selectScoutProducts(calendar.activeProducts, scheduledTime);
      if (products.length === 0) {
        const health = { status: "completed", checkedAt, activeReferences: [], searchResults: 0, qualified: 0, alerted: 0 };
        await this.state.storage.put("protected-scout:health", health);
        return Response.json(health);
      }

      const budgetKey = monthlyBudgetKey(scheduledTime);
      const used = (await this.state.storage.get<number>(budgetKey)) ?? 0;
      if (used >= PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP) {
        const health = {
          status: "degraded",
          checkedAt,
          activeReferences: products.map((product) => product.id),
          searchResults: 0,
          qualified: 0,
          alerted: 0,
          monthlySearchRequests: used,
          monthlySearchCap: PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP,
          error: "Budget Brave Protected Scout atteint."
        };
        await this.state.storage.put("protected-scout:health", health);
        return Response.json(health);
      }

      const query = buildProtectedStoreScoutQuery(products);
      const results = await fetchBrave(apiKey, query);
      await this.state.storage.put(budgetKey, used + 1);
      const qualified = results
        .map((result) => qualifyProtectedSearchResult(result, products))
        .filter((finding): finding is ProtectedFinding => Boolean(finding));

      let alerted = 0;
      let skippedSeen = 0;
      const deliveryErrors: string[] = [];
      for (const finding of qualified) {
        if (alerted >= MAX_ALERTS_PER_RUN) break;
        const key = findingKey(finding);
        if (await this.state.storage.get(key)) {
          skippedSeen += 1;
          continue;
        }
        const delivery = await dispatchDiscordPayloads([protectedScoutPayload(finding, scheduledTime)], this.env);
        if (delivery.mode === "dry-run" || delivery.sent === 1) {
          await this.state.storage.put(key, checkedAt);
        }
        if (delivery.sent === 1) alerted += 1;
        deliveryErrors.push(...delivery.errors);
      }

      const health = {
        status: deliveryErrors.length ? "degraded" : "completed",
        checkedAt,
        query,
        activeReferences: products.map((product) => product.id),
        searchResults: results.length,
        qualified: qualified.length,
        alerted,
        skippedSeen,
        monthlySearchRequests: used + 1,
        monthlySearchCap: PROTECTED_STORE_SCOUT_MONTHLY_SEARCH_CAP,
        ...(deliveryErrors.length ? { deliveryErrors: deliveryErrors.slice(0, 8) } : {})
      };
      await this.state.storage.put("protected-scout:health", health);
      return Response.json(health);
    } catch (error) {
      const health = {
        status: "error",
        checkedAt: new Date(scheduledTime).toISOString(),
        alerted: 0,
        error: safeError(error)
      };
      await this.state.storage.put("protected-scout:health", health);
      return Response.json(health, { status: 500 });
    }
  }
}
