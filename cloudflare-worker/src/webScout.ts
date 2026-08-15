import { CONNECTORS } from "./connectors";
import { dispatchDiscordPayloads } from "./discord";
import { loadOfficialCalendar } from "./officialCalendar";
import { aliasesForProduct, type OfficialProduct } from "./opwatchV1";
import type { StateStore } from "./state";
import type { DiscordPayload, Env, ProductSnapshot } from "./types";
import opWatchV1Config from "../config/opwatch-v1.json";

export const WEB_SCOUT_MINUTE = 7;
export const WEB_SCOUT_MIN_DOMAIN_AGE_DAYS = 180;
export const WEB_SCOUT_MAX_VERIFY = 4;
export const WEB_SCOUT_MAX_ALERTS = 4;
export const WEB_SCOUT_MONTHLY_SEARCH_REQUEST_CAP = 744;

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const IANA_RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 900_000;
const DOMAIN_TRUST_TTL_MS = 7 * 86_400_000;
const REJECT_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 500;

const SOCIAL_DOMAINS = new Set(["facebook.com", "instagram.com"]);
const DISCOVERY_BLOCKED_DOMAINS = new Set([
  "ebay.fr",
  "ebay.com",
  "rakuten.com",
  "rakuten.fr",
  "leboncoin.fr",
  "pinterest.com",
  "pinterest.fr",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "dealabs.com"
]);
const COMPOUND_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "com.be", "co.jp"]);

interface ScoutEnv extends Env {
  BRAVE_SEARCH_API_KEY?: string;
  RUNTIME_TEST_MODE?: string;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

interface DomainTrust {
  trusted: boolean;
  checkedAt: string;
  domain: string;
  ageDays?: number;
  legalIdentifier?: string;
  addressEvidence: boolean;
  legalPage?: string;
  reason: string;
}

export interface WebScoutFinding {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: "web" | "facebook" | "instagram";
  matchedProductIds: string[];
  knownStore?: string;
  trustReason: string;
  domainAgeDays?: number;
  legalIdentifier?: string;
  snippet?: string;
}

export interface WebScoutHealth {
  status: "completed" | "disabled" | "degraded" | "error";
  checkedAt: string;
  query?: string;
  activeReferences: string[];
  searchResults: number;
  candidates?: number;
  verified: number;
  alerted: number;
  skippedCached: number;
  rejected: number;
  lastBraveCallAt?: string;
  nextExpectedRunAt?: string;
  monthlySearchRequests?: number;
  monthlySearchRequestCap?: number;
  rejectionReasons?: Record<string, number>;
  recentRejections?: Array<{ domain: string; reason: string }>;
  deliveryErrors?: string[];
  error?: string;
}

interface WebScoutVerification {
  finding?: WebScoutFinding;
  reason?: string;
}

interface TimedCacheEntry {
  id: string;
  at: string;
  until?: string;
}

interface WebScoutResponseSnapshot {
  body: string;
  status: number;
}

interface IanaBootstrap {
  services?: Array<[string[], string[]]>;
}

class ScoutStateStore implements StateStore {
  readonly mode = "memory" as const;
  readonly writable: boolean;

  constructor(private readonly storage: DurableObjectStorage, writable: boolean) {
    this.writable = writable;
  }

  async get(key: string): Promise<ProductSnapshot | undefined> {
    return await this.storage.get<ProductSnapshot>(`product:${key}`);
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    if (this.writable) await this.storage.put(`product:${key}`, value);
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return await this.storage.get<string>(`metadata:${key}`);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    if (this.writable) await this.storage.put(`metadata:${key}`, value);
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function webScoutSnapshot(data: unknown, status = 200): WebScoutResponseSnapshot {
  return { body: JSON.stringify(data), status };
}

function responseFromWebScoutSnapshot(snapshot: WebScoutResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOfHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return COMPOUND_PUBLIC_SUFFIXES.has(lastTwo)
    ? labels.slice(-3).join(".")
    : lastTwo;
}

export function registeredDomainFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return domainOfHostname(url.hostname);
  } catch {
    return undefined;
  }
}

function ipv4Private(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function publicHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || ipv4Private(host)) return undefined;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function sourceTypeForUrl(value: string): WebScoutFinding["sourceType"] | "blocked" {
  const domain = registeredDomainFromUrl(value);
  if (!domain) return "blocked";
  if (DISCOVERY_BLOCKED_DOMAINS.has(domain)) return "blocked";
  if (domain === "facebook.com") return "facebook";
  if (domain === "instagram.com") return "instagram";
  return "web";
}

function knownStoreForDomain(domain: string): string | undefined {
  for (const connector of CONNECTORS) {
    const domains = connector.sources.flatMap((source) => {
      const candidate = registeredDomainFromUrl(source);
      return candidate ? [candidate] : [];
    });
    if (domains.includes(domain)) return connector.name;
  }
  return undefined;
}

function knownStoreFromText(value: string): string | undefined {
  const text = normalizeText(value);
  return CONNECTORS.find((connector) => {
    const name = normalizeText(connector.name);
    return name.length >= 4 && text.includes(name);
  })?.name;
}

export function isWebScoutTick(scheduledTime: number): boolean {
  const date = new Date(scheduledTime);
  return date.getUTCMinutes() === WEB_SCOUT_MINUTE;
}

export function selectScoutProducts(products: OfficialProduct[], scheduledTime: number): OfficialProduct[] {
  const sorted = [...products].sort((left, right) =>
    left.releaseDate.localeCompare(right.releaseDate) || left.id.localeCompare(right.id)
  );
  if (sorted.length <= 6) return sorted;
  const chunks: OfficialProduct[][] = [];
  for (let index = 0; index < sorted.length; index += 6) chunks.push(sorted.slice(index, index + 6));
  const hourBucket = Math.floor(scheduledTime / 3_600_000);
  return chunks[hourBucket % chunks.length];
}

export function buildWebScoutQuery(products: OfficialProduct[]): string {
  const refs = products.map((product) => `\"${product.id}\"`).join(" OR ");
  const query = `(${refs}) \"One Piece\" (précommande OR preorder OR \"en stock\" OR display OR booster) France français`;
  return query.slice(0, 400);
}

export function matchedProductIds(value: string, products: OfficialProduct[]): string[] {
  const normalized = normalizeText(value);
  return products.filter((product) =>
    aliasesForProduct(product.id).some((alias) => normalized.includes(normalizeText(alias)))
  ).map((product) => product.id);
}

export function hasCommercialSignal(value: string): boolean {
  return /\bpr[eé]commande\b|\bpreorder\b|\ben stock\b|\bdisponible\b|ajouter au panier|add to cart|\bdisplay\b|booster|\b(?:eur|€)\b/i.test(value);
}

export function hasFrenchSignal(value: string): boolean {
  const explicitFrench = /lang=["']fr(?:-|["'])|\bfran[çc]ais\b|\bversion\s+fr\b|\bvf\b|(?:^|[\s([\-|])fr(?:$|[\s)\]|-])/i.test(value);
  const explicitForeign = /\bversion\s+(?:anglaise|japonaise)\b|\benglish\s+version\b|\bjapanese\s+version\b|(?:^|[\s([\-|])jp(?:$|[\s)\]|-])|(?:^|[\s([\-|])eng(?:$|[\s)\]|-])/i.test(value);
  return explicitFrench || !explicitForeign;
}

export function extractLegalEvidence(value: string): {
  legalIdentifier?: string;
  addressEvidence: boolean;
} {
  const compact = value.replace(/[\u00a0\s]+/g, " ");
  const patterns = [
    /\bSIRET\s*[:#-]?\s*(\d(?:[ .-]?\d){13})\b/i,
    /\bSIREN\s*[:#-]?\s*(\d(?:[ .-]?\d){8})\b/i,
    /\bRCS\s+[A-ZÀ-ÖØ-öø-ÿ' -]{2,40}\s+(\d(?:[ .-]?\d){8})\b/i,
    /\bTVA(?:\s+intracommunautaire)?\s*[:#-]?\s*(FR\s?\d{2}\s?(?:\d\s?){9})\b/i
  ];
  const legalIdentifier = patterns.map((pattern) => compact.match(pattern)?.[0]).find(Boolean);
  const addressEvidence = /\b\d{5}\b/.test(compact) &&
    /\b(?:rue|avenue|av\.?|boulevard|bd\.?|route|chemin|place|all[eé]e|impasse|quai|france)\b/i.test(compact);
  return { legalIdentifier, addressEvidence };
}

function hasLegalLink(value: string): boolean {
  return /mentions?[-_/ ]l[eé]gales?|legal[-_/ ]notice|conditions?[-_/ ]g[eé]n[eé]rales?|\bcgv\b/i.test(value);
}

function findLegalUrl(html: string, baseUrl: string): string | undefined {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of links) {
    const label = `${match[1]} ${match[2]}`;
    if (!hasLegalLink(label)) continue;
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol !== "https:" || registeredDomainFromUrl(url.toString()) !== registeredDomainFromUrl(baseUrl)) continue;
      return url.toString();
    } catch {
      // Continue avec le lien suivant.
    }
  }
  return undefined;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedFindingUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|ref|ref_|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

function findingId(url: string, refs: string[]): string {
  return fnv1a(`${normalizedFindingUrl(url)}|${[...refs].sort().join(",")}`);
}

async function readTextLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("réponse trop volumineuse");
      chunks.push(value);
    }
  } finally {
    if (total > MAX_RESPONSE_BYTES) await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function safeFetchText(value: string, redirects = 0): Promise<{ url: string; text: string; status: number }> {
  const target = publicHttpsUrl(value);
  if (!target) throw new Error("URL non publique refusée");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch-WebScout/1.0 (+trusted-commerce-discovery)",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 3) throw new Error("trop de redirections");
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirection HTTP ${response.status} sans Location`);
      return await safeFetchText(new URL(location, target).toString(), redirects + 1);
    }
    const text = await readTextLimited(response);
    return { url: response.url || target.toString(), text, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function challengePage(value: string): boolean {
  return /just a moment|captcha|verify (?:you are|that you are) human|security verification|access denied/i.test(value.slice(0, 80_000));
}

async function fetchBraveResults(apiKey: string, query: string): Promise<BraveWebResult[]> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("country", "FR");
  url.searchParams.set("search_lang", "fr");
  url.searchParams.set("ui_lang", "fr-FR");
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("freshness", "pm");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
    const data = await response.json() as BraveSearchResponse;
    return data.web?.results ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(value: string): Promise<unknown> {
  const response = await safeFetchText(value);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  return JSON.parse(response.text) as unknown;
}

async function ianaBootstrap(storage: DurableObjectStorage): Promise<IanaBootstrap> {
  const cached = await storage.get<{ fetchedAt: string; data: IanaBootstrap }>("web-scout:iana-bootstrap");
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) return cached.data;
  const data = await fetchJson(IANA_RDAP_BOOTSTRAP_URL) as IanaBootstrap;
  await storage.put("web-scout:iana-bootstrap", { fetchedAt: new Date().toISOString(), data });
  return data;
}

function rdapServerForDomain(domain: string, bootstrap: IanaBootstrap): string | undefined {
  const tld = domain.split(".").at(-1)?.toLowerCase();
  if (!tld) return undefined;
  for (const [tlds, servers] of bootstrap.services ?? []) {
    if (tlds.map((item) => item.toLowerCase()).includes(tld)) return servers[0];
  }
  return undefined;
}

export function registrationDateFromRdap(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const events = (data as { events?: Array<{ eventAction?: string; eventDate?: string }> }).events ?? [];
  return events.find((event) => /registration|creation|registered/i.test(event.eventAction ?? "") &&
    typeof event.eventDate === "string")?.eventDate;
}

async function domainAgeDays(storage: DurableObjectStorage, domain: string, now: number): Promise<number | undefined> {
  const bootstrap = await ianaBootstrap(storage);
  const server = rdapServerForDomain(domain, bootstrap);
  if (!server) return undefined;
  const base = server.endsWith("/") ? server : `${server}/`;
  const data = await fetchJson(`${base}domain/${encodeURIComponent(domain)}`);
  const created = registrationDateFromRdap(data);
  if (!created) return undefined;
  const createdAt = Date.parse(created);
  if (!Number.isFinite(createdAt) || createdAt > now) return undefined;
  return Math.floor((now - createdAt) / 86_400_000);
}

function domainTrustCacheKey(domain: string): string {
  return `web-scout:domain-trust:${domain}`;
}

async function validateDomainTrust(
  storage: DurableObjectStorage,
  originUrl: string,
  pageHtml: string | undefined,
  now: number
): Promise<DomainTrust> {
  const domain = registeredDomainFromUrl(originUrl);
  if (!domain) return { trusted: false, checkedAt: new Date(now).toISOString(), domain: "", addressEvidence: false, reason: "domaine invalide" };

  const cached = await storage.get<DomainTrust>(domainTrustCacheKey(domain));
  if (cached && now - Date.parse(cached.checkedAt) < DOMAIN_TRUST_TTL_MS) return cached;

  const knownStore = knownStoreForDomain(domain);
  if (knownStore) {
    const trusted: DomainTrust = {
      trusted: true,
      checkedAt: new Date(now).toISOString(),
      domain,
      addressEvidence: true,
      reason: `domaine déjà qualifié OP Watch (${knownStore})`
    };
    await storage.put(domainTrustCacheKey(domain), trusted);
    return trusted;
  }

  try {
    const origin = new URL(originUrl).origin;
    const homepage = await safeFetchText(`${origin}/`);
    if (homepage.status < 200 || homepage.status >= 400 || challengePage(homepage.text)) {
      throw new Error(`accueil non exploitable HTTP ${homepage.status}`);
    }
    const legalUrl = findLegalUrl(`${pageHtml ?? ""}\n${homepage.text}`, homepage.url);
    if (!legalUrl) throw new Error("mentions légales/CGV introuvables");
    const legalPage = await safeFetchText(legalUrl);
    if (legalPage.status < 200 || legalPage.status >= 400 || challengePage(legalPage.text)) {
      throw new Error(`page légale non exploitable HTTP ${legalPage.status}`);
    }
    const evidence = extractLegalEvidence(`${homepage.text}\n${legalPage.text}`);
    if (!evidence.legalIdentifier) throw new Error("SIREN/SIRET/RCS/TVA introuvable");
    if (!evidence.addressEvidence) throw new Error("adresse physique française non confirmée");
    const ageDays = await domainAgeDays(storage, domain, now);
    if (ageDays === undefined) throw new Error("ancienneté du domaine non vérifiable par RDAP");
    if (ageDays < WEB_SCOUT_MIN_DOMAIN_AGE_DAYS) throw new Error(`domaine trop récent (${ageDays} jours)`);

    const trusted: DomainTrust = {
      trusted: true,
      checkedAt: new Date(now).toISOString(),
      domain,
      ageDays,
      legalIdentifier: evidence.legalIdentifier,
      addressEvidence: evidence.addressEvidence,
      legalPage: legalUrl,
      reason: `mentions légales + identité entreprise + domaine âgé de ${ageDays} jours`
    };
    await storage.put(domainTrustCacheKey(domain), trusted);
    return trusted;
  } catch (error) {
    const rejected: DomainTrust = {
      trusted: false,
      checkedAt: new Date(now).toISOString(),
      domain,
      addressEvidence: false,
      reason: safeError(error)
    };
    await storage.put(domainTrustCacheKey(domain), rejected);
    return rejected;
  }
}

function externalDomainsFromText(value: string): string[] {
  const matches = [...value.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)];
  return [...new Set(matches.map((match) => domainOfHostname(match[1])))]
    .filter((domain) => !SOCIAL_DOMAINS.has(domain) && !DISCOVERY_BLOCKED_DOMAINS.has(domain));
}

function resultText(result: BraveWebResult): string {
  return [result.title, result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" \n");
}

async function verifySearchResult(
  storage: DurableObjectStorage,
  result: BraveWebResult,
  products: OfficialProduct[],
  now: number
): Promise<WebScoutVerification> {
  if (!result.url || !result.title) return { reason: "résultat Brave incomplet" };
  const target = publicHttpsUrl(result.url);
  if (!target) return { reason: "URL non HTTPS ou non publique" };
  const sourceType = sourceTypeForUrl(target.toString());
  if (sourceType === "blocked") return { reason: "marketplace/social/source bloqué par politique" };
  const searchText = resultText(result);
  const searchRefs = matchedProductIds(searchText, products);

  if (sourceType === "facebook" || sourceType === "instagram") {
    if (searchRefs.length === 0 || !/one[\s-]*piece/i.test(searchText) || !hasCommercialSignal(searchText) || !hasFrenchSignal(searchText)) {
      return { reason: "publication sociale sans preuve One Piece + référence + signal commercial FR" };
    }
    const knownStore = knownStoreFromText(`${result.title} ${result.description ?? ""}`);
    if (knownStore) {
      return { finding: {
        id: findingId(target.toString(), searchRefs),
        title: result.title,
        url: target.toString(),
        domain: registeredDomainFromUrl(target.toString())!,
        sourceType,
        matchedProductIds: searchRefs,
        knownStore,
        trustReason: `publication sociale rattachée à la boutique déjà qualifiée ${knownStore}`,
        snippet: result.description
      } };
    }

    const trustFailures: string[] = [];
    for (const domain of externalDomainsFromText(searchText).slice(0, 2)) {
      const trust = await validateDomainTrust(storage, `https://${domain}/`, undefined, now);
      if (!trust.trusted) {
        trustFailures.push(`${domain}: ${trust.reason}`);
        continue;
      }
      return { finding: {
        id: findingId(target.toString(), searchRefs),
        title: result.title,
        url: target.toString(),
        domain,
        sourceType,
        matchedProductIds: searchRefs,
        trustReason: `publication sociale reliée au site ${domain} : ${trust.reason}`,
        domainAgeDays: trust.ageDays,
        legalIdentifier: trust.legalIdentifier,
        snippet: result.description
      } };
    }
    return {
      reason: trustFailures.length
        ? `marchand social non vérifié — ${trustFailures.join(" | ").slice(0, 500)}`
        : "publication sociale sans marchand français vérifiable"
    };
  }

  const page = await safeFetchText(target.toString());
  if (challengePage(page.text)) return { reason: "page rejetée : challenge/security" };
  if (page.status < 200 || page.status >= 400) return { reason: `page produit HTTP ${page.status}` };
  const combined = `${searchText}\n${page.text}`;
  const refs = matchedProductIds(combined, products);
  if (refs.length === 0 || !/one[\s-]*piece/i.test(combined) || !hasCommercialSignal(combined) || !hasFrenchSignal(combined)) {
    return { reason: "page sans preuve One Piece + référence + signal commercial FR" };
  }
  const finalDomain = registeredDomainFromUrl(page.url);
  if (!finalDomain || DISCOVERY_BLOCKED_DOMAINS.has(finalDomain) || SOCIAL_DOMAINS.has(finalDomain)) {
    return { reason: "redirection vers un domaine bloqué" };
  }
  const trust = await validateDomainTrust(storage, page.url, page.text, now);
  if (!trust.trusted) return { reason: `marchand non vérifié — ${trust.reason}` };
  return { finding: {
    id: findingId(page.url, refs),
    title: result.title,
    url: page.url,
    domain: finalDomain,
    sourceType: "web",
    matchedProductIds: refs,
    knownStore: knownStoreForDomain(finalDomain),
    trustReason: trust.reason,
    domainAgeDays: trust.ageDays,
    legalIdentifier: trust.legalIdentifier,
    snippet: result.description
  } };
}

async function readCache(storage: DurableObjectStorage, key: string): Promise<TimedCacheEntry[]> {
  return (await storage.get<TimedCacheEntry[]>(key)) ?? [];
}

async function writeCache(storage: DurableObjectStorage, key: string, values: TimedCacheEntry[]): Promise<void> {
  await storage.put(key, values.slice(-MAX_CACHE_ENTRIES));
}

function cacheHas(values: TimedCacheEntry[], id: string, now: number): boolean {
  const item = values.find((entry) => entry.id === id);
  if (!item) return false;
  if (!item.until) return true;
  const until = Date.parse(item.until);
  return Number.isFinite(until) && until > now;
}

function buildWebScoutPayload(finding: WebScoutFinding, now: number): DiscordPayload {
  const detected = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris"
  }).format(new Date(now));
  const sourceLabel = finding.sourceType === "facebook" ? "Facebook" : finding.sourceType === "instagram" ? "Instagram" : "Web";
  const trustBits = [
    finding.trustReason,
    finding.domainAgeDays !== undefined ? `ancienneté domaine: ${finding.domainAgeDays} j` : undefined,
    finding.legalIdentifier
  ].filter(Boolean).join(" • ");
  return {
    username: "OP Watch",
    embeds: [{
      title: `🔭 WEB SCOUT • piste fiable — ${finding.matchedProductIds.join(", ")}`,
      url: finding.url,
      description: finding.title,
      fields: [
        { name: "🎯 Référence", value: finding.matchedProductIds.join(", "), inline: true },
        { name: "🌐 Source", value: sourceLabel, inline: true },
        { name: "🏪 Site / magasin", value: finding.knownStore ?? finding.domain, inline: true },
        { name: "✅ Pourquoi remonté", value: trustBits.slice(0, 1000), inline: false },
        ...(finding.snippet ? [{ name: "🔎 Extrait", value: finding.snippet.slice(0, 900), inline: false }] : []),
        { name: "🕒 Détecté", value: detected, inline: true },
        { name: "🔗 Piste", value: `[Ouvrir la page](${finding.url})`, inline: false }
      ],
      footer: { text: "OP Watch • Web Scout • piste vérifiée, non ajoutée automatiquement au Fast Watch" },
      timestamp: new Date(now).toISOString()
    }]
  };
}

function monthlySearchBudgetKey(scheduledTime: number): string {
  return `web-scout:search-budget:${new Date(scheduledTime).toISOString().slice(0, 7)}`;
}

function nextExpectedRunAt(scheduledTime: number): string {
  const next = new Date(scheduledTime);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  next.setUTCMinutes(WEB_SCOUT_MINUTE);
  return next.toISOString();
}

function candidateResultCount(results: BraveWebResult[]): number {
  return results.filter((result) => {
    if (!result.url || !result.title) return false;
    const target = publicHttpsUrl(result.url);
    return Boolean(target && sourceTypeForUrl(target.toString()) !== "blocked");
  }).length;
}

function addReason(reasons: Record<string, number>, reason: string): void {
  const normalized = reason.replace(/\s+/g, " ").trim().slice(0, 500) || "raison inconnue";
  reasons[normalized] = (reasons[normalized] ?? 0) + 1;
}

export class WebScoutDurableObject {
  private running?: Promise<WebScoutResponseSnapshot>;

  constructor(private readonly state: DurableObjectState, private readonly env: ScoutEnv) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      return new Response(JSON.stringify({ health: await this.state.storage.get<WebScoutHealth>("web-scout:health") }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }
    if (request.method !== "POST" || pathname !== "/run") {
      return new Response(JSON.stringify({ error: "Route Web Scout invalide." }), { status: 404, headers: { "content-type": "application/json" } });
    }
    if (this.running) return responseFromWebScoutSnapshot(await this.running);

    this.running = this.run(request);
    try {
      return responseFromWebScoutSnapshot(await this.running);
    } finally {
      this.running = undefined;
    }
  }

  private async run(request: Request): Promise<WebScoutResponseSnapshot> {
    const nowFallback = Date.now();
    let scheduledTime = nowFallback;
    try {
      const input = await request.json() as { scheduledTime?: number };
      scheduledTime = Number(input.scheduledTime);
      if (!Number.isFinite(scheduledTime)) throw new Error("scheduledTime invalide");
      const checkedAt = new Date(scheduledTime).toISOString();
      const apiKey = this.env.BRAVE_SEARCH_API_KEY?.trim();
      if (!apiKey || this.env.RUNTIME_TEST_MODE === "true") {
        const health: WebScoutHealth = {
          status: "disabled",
          checkedAt,
          activeReferences: [],
          searchResults: 0,
          verified: 0,
          alerted: 0,
          skippedCached: 0,
          rejected: 0,
          error: apiKey ? "Web Scout désactivé en runtime test." : "BRAVE_SEARCH_API_KEY absent."
        };
        await this.state.storage.put("web-scout:health", health);
        return webScoutSnapshot(health);
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
        const health: WebScoutHealth = {
          status: "completed",
          checkedAt,
          activeReferences: [],
          searchResults: 0,
          verified: 0,
          alerted: 0,
          skippedCached: 0,
          rejected: 0
        };
        await this.state.storage.put("web-scout:health", health);
        return webScoutSnapshot(health);
      }

      const query = buildWebScoutQuery(products);
      const budgetKey = monthlySearchBudgetKey(scheduledTime);
      const usedRequests = (await this.state.storage.get<number>(budgetKey)) ?? 0;
      if (usedRequests >= WEB_SCOUT_MONTHLY_SEARCH_REQUEST_CAP) {
        const health: WebScoutHealth = {
          status: "degraded",
          checkedAt,
          query,
          activeReferences: products.map((product) => product.id),
          searchResults: 0,
          candidates: 0,
          verified: 0,
          alerted: 0,
          skippedCached: 0,
          rejected: 0,
          nextExpectedRunAt: nextExpectedRunAt(scheduledTime),
          monthlySearchRequests: usedRequests,
          monthlySearchRequestCap: WEB_SCOUT_MONTHLY_SEARCH_REQUEST_CAP,
          rejectionReasons: {},
          error: "Budget Brave mensuel atteint : aucun appel supplémentaire n'a été effectué."
        };
        await this.state.storage.put("web-scout:health", health);
        return webScoutSnapshot(health);
      }
      await this.state.storage.put(budgetKey, usedRequests + 1);
      const results = await fetchBraveResults(apiKey, query);
      const seen = await readCache(this.state.storage, "web-scout:seen");
      const rejectedCache = await readCache(this.state.storage, "web-scout:rejected");
      let skippedCached = 0;
      let rejected = 0;
      let verified = 0;
      let alerted = 0;
      const rejectionReasons: Record<string, number> = {};
      const recentRejections: Array<{ domain: string; reason: string }> = [];
      const deliveryErrors: string[] = [];

      for (const result of results) {
        if (verified >= WEB_SCOUT_MAX_VERIFY || alerted >= WEB_SCOUT_MAX_ALERTS) break;
        if (!result.url) continue;
        const preliminaryRefs = matchedProductIds(resultText(result), products);
        const id = findingId(result.url, preliminaryRefs.length ? preliminaryRefs : products.map((product) => product.id));
        if (cacheHas(seen, id, scheduledTime) || cacheHas(rejectedCache, id, scheduledTime)) {
          skippedCached += 1;
          continue;
        }
        verified += 1;
        try {
          const verification = await verifySearchResult(this.state.storage, result, products, scheduledTime);
          if (!verification.finding) {
            const reason = verification.reason ?? "candidat non qualifié";
            rejected += 1;
            addReason(rejectionReasons, reason);
            recentRejections.push({
              domain: registeredDomainFromUrl(result.url) ?? "domaine inconnu",
              reason: reason.slice(0, 500)
            });
            rejectedCache.push({ id, at: checkedAt, until: new Date(scheduledTime + REJECT_TTL_MS).toISOString() });
            continue;
          }
          const finding = verification.finding;
          const findingAlreadySeen = cacheHas(seen, finding.id, scheduledTime);
          if (findingAlreadySeen) {
            skippedCached += 1;
            continue;
          }
          const delivery = await dispatchDiscordPayloads([buildWebScoutPayload(finding, scheduledTime)], this.env);
          if (delivery.sent === 1) {
            alerted += 1;
            seen.push({ id: finding.id, at: checkedAt });
          } else if (delivery.mode === "dry-run") {
            seen.push({ id: finding.id, at: checkedAt });
          } else {
            deliveryErrors.push(...delivery.errors);
          }
        } catch (error) {
          const reason = `exception de vérification — ${safeError(error)}`;
          rejected += 1;
          addReason(rejectionReasons, reason);
          recentRejections.push({
            domain: registeredDomainFromUrl(result.url) ?? "domaine inconnu",
            reason: reason.slice(0, 500)
          });
          rejectedCache.push({ id, at: checkedAt, until: new Date(scheduledTime + REJECT_TTL_MS).toISOString() });
        }
      }

      await writeCache(this.state.storage, "web-scout:seen", seen);
      await writeCache(this.state.storage, "web-scout:rejected", rejectedCache);
      const health: WebScoutHealth = {
        status: "completed",
        checkedAt,
        query,
        activeReferences: products.map((product) => product.id),
        searchResults: results.length,
        candidates: candidateResultCount(results),
        verified,
        alerted,
        skippedCached,
        rejected,
        lastBraveCallAt: checkedAt,
        nextExpectedRunAt: nextExpectedRunAt(scheduledTime),
        monthlySearchRequests: usedRequests + 1,
        monthlySearchRequestCap: WEB_SCOUT_MONTHLY_SEARCH_REQUEST_CAP,
        rejectionReasons,
        recentRejections: recentRejections.slice(-8),
        ...(deliveryErrors.length ? { deliveryErrors: deliveryErrors.slice(0, 8) } : {})
      };
      await this.state.storage.put("web-scout:health", health);
      return webScoutSnapshot(health);
    } catch (error) {
      const health: WebScoutHealth = {
        status: "error",
        checkedAt: new Date(scheduledTime || nowFallback).toISOString(),
        activeReferences: [],
        searchResults: 0,
        verified: 0,
        alerted: 0,
        skippedCached: 0,
        rejected: 0,
        error: safeError(error)
      };
      await this.state.storage.put("web-scout:health", health);
      return webScoutSnapshot(health, 500);
    }
  }
}
