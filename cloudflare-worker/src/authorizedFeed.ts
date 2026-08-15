import { detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";
import { enrichCandidateIdentity } from "./opwatchV1";
import type { StateStore } from "./state";
import type { Availability, ConnectorDefinition, ProductCandidate, StoreAudit } from "./types";

// Les catalogues partenaires réels font actuellement jusqu'à ~28 Mo. Ils ne
// doivent jamais être matérialisés en entier : on les parcourt par flux et on
// ne conserve que les lignes One Piece qualifiables.
const MAX_FEED_TRANSFER_BYTES = 40_000_000;
const MAX_FEED_RECORD_CHARS = 750_000;
const MAX_FEED_CANDIDATES = 2_000;
const FEED_TIMEOUT_MS = 25_000;
const REVALIDATION_METADATA_PREFIX = "authorized-feed:http-cache:v1";
const MAX_VALIDATOR_CHARS = 512;

type FeedRow = Record<string, string>;

interface FeedRevalidationState {
  sourceHash: string;
  baseline: true;
  etag?: string;
  lastModified?: string;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeValidator(value: string | null): string | undefined {
  const cleaned = value?.replace(/[\r\n]/g, "").trim();
  return cleaned && cleaned.length <= MAX_VALIDATOR_CHARS ? cleaned : undefined;
}

function cacheValidationKind(state: Pick<FeedRevalidationState, "etag" | "lastModified">):
  "etag" | "last-modified" | "etag+last-modified" | "none" {
  if (state.etag && state.lastModified) return "etag+last-modified";
  if (state.etag) return "etag";
  if (state.lastModified) return "last-modified";
  return "none";
}

async function readRevalidationState(
  store: StateStore | undefined,
  metadataKey: string,
  sourceHash: string
): Promise<FeedRevalidationState | undefined> {
  if (!store) return undefined;
  try {
    const raw = await store.getMetadata(metadataKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<FeedRevalidationState>;
    if (parsed.sourceHash !== sourceHash || parsed.baseline !== true) return undefined;
    return {
      sourceHash,
      baseline: true,
      ...(safeValidator(parsed.etag ?? null) ? { etag: safeValidator(parsed.etag ?? null) } : {}),
      ...(safeValidator(parsed.lastModified ?? null) ? { lastModified: safeValidator(parsed.lastModified ?? null) } : {})
    };
  } catch {
    return undefined;
  }
}

async function persistRevalidationState(
  store: StateStore | undefined,
  metadataKey: string,
  state: FeedRevalidationState
): Promise<void> {
  if (!store?.writable) return;
  await store.putMetadata(metadataKey, JSON.stringify(state));
}

const FIELD_ALIASES = {
  title: ["title", "name", "product_name", "productname", "nom", "libelle", "label"],
  url: ["url", "product_url", "producturl", "aw_deep_link", "deeplink", "deep_link", "link", "lien"],
  price: ["price", "search_price", "sale_price", "current_price", "prix", "prix_ttc"],
  image: ["image", "image_url", "imageurl", "merchant_image_url", "aw_image_url", "picture", "photo"],
  stock: ["stock", "stock_status", "availability", "available", "in_stock", "instock", "disponibilite", "disponible"],
  language: ["language", "lang", "langue"],
  description: ["description", "desc", "product_description", "merchant_product_description"],
  seller: ["seller", "seller_name", "merchant", "merchant_name", "vendeur", "vendor"],
  id: ["id", "product_id", "merchant_product_id", "sku", "ean", "ean13", "gtin"]
} as const;

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pick(row: FeedRow, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeKey(alias)];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function logicalCsvLines(raw: string): string[] {
  const lines: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    current += char;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        current += raw[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      const trimmed = current.trim();
      if (trimmed && !trimmed.startsWith("#")) lines.push(trimmed);
      current = "";
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
    }
  }
  const trimmed = current.trim();
  if (trimmed && !trimmed.startsWith("#")) lines.push(trimmed);
  return lines;
}

function scoreDelimiter(header: string, delimiter: string): number {
  return parseDelimitedLine(header, delimiter).length;
}

function parseCsv(raw: string): FeedRow[] {
  const lines = logicalCsvLines(raw);
  if (lines.length < 2) return [];
  const delimiters = ["\t", ";", ",", "|"];
  const delimiter = delimiters.sort((a, b) => scoreDelimiter(lines[0], b) - scoreDelimiter(lines[0], a))[0];
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeKey);
  if (headers.length < 2) return [];

  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const row: FeedRow = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? "";
    });
    return row;
  });
}

function objectToRow(value: unknown): FeedRow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row: FeedRow = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null || item === undefined) continue;
    if (["string", "number", "boolean"].includes(typeof item)) {
      row[normalizeKey(key)] = String(item);
    }
  }
  return row;
}

function parseJson(raw: string): FeedRow[] {
  const parsed = JSON.parse(raw) as unknown;
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as Record<string, unknown>).products ?? (parsed as Record<string, unknown>).items ?? (parsed as Record<string, unknown>).results)
      : undefined;
  if (!Array.isArray(values)) return [];
  return values.map(objectToRow).filter((row): row is FeedRow => Boolean(row));
}

function parseXmlFields(block: string): FeedRow {
  const row: FeedRow = {};
  for (const match of block.matchAll(/<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const key = normalizeKey(match[1].replace(/^.*:/, ""));
    const value = stripHtml(decodeXml(match[2])).trim();
    if (key && value && !row[key]) row[key] = value;
  }
  return row;
}

function parseXml(raw: string): FeedRow[] {
  const tags = ["product", "item", "article", "offer", "entry"];
  for (const tag of tags) {
    const blocks = [...raw.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))];
    if (blocks.length > 0) return blocks.map((match) => parseXmlFields(match[1]));
  }
  return [];
}

export function parseAuthorizedFeed(raw: string, contentType = ""): FeedRow[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (/json/i.test(contentType) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try { return parseJson(trimmed); } catch { /* fallback below */ }
  }
  if (/xml/i.test(contentType) || trimmed.startsWith("<")) {
    const rows = parseXml(trimmed);
    if (rows.length > 0) return rows;
  }
  return parseCsv(trimmed);
}

function explicitAvailability(value: string): Availability {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (/^\d+$/.test(normalized)) return Number(normalized) > 0 ? "available" : "unavailable";
  if (/^(?:1|true|yes|oui|in stock|instock|available|disponible)$/i.test(normalized)) return "available";
  if (/pre[- ]?order|precommande|précommande/i.test(normalized)) return "preorder";
  if (/^(?:0|false|no|non|out of stock|oos|unavailable|indisponible|rupture|epuise|épuisé)$/i.test(normalized)) return "unavailable";
  return detectAvailability(value);
}

function commercialEligibility(connector: ConnectorDefinition, seller: string): { eligible: boolean; reason?: string } {
  if (connector.commercialAlertsEnabled === false) {
    return { eligible: false, reason: "Connecteur en découverte uniquement." };
  }
  if (connector.requiredSellerPatterns?.length) {
    if (!seller || !connector.requiredSellerPatterns.some((pattern) => pattern.test(seller))) {
      return { eligible: false, reason: `${connector.requiredSellerLabel ?? "Vendeur attendu"} non confirmé dans le flux autorisé.` };
    }
  }
  return { eligible: true };
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function privateOrLocalHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value === "::1") return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:|^fe8[0-9a-f]:/i.test(value)) return true;

  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224;
}

function safeFeedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/^(?:L'URL du flux autorisé|Flux autorisé|Redirection du flux autorisé)/i.test(message)) {
    return message;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Flux autorisé: délai réseau dépassé";
  }
  return "Flux autorisé: échec réseau sans détail sensible";
}

function rowToCandidate(row: FeedRow, connector: ConnectorDefinition): ProductCandidate | undefined {
  const title = pick(row, FIELD_ALIASES.title);
  const url = safeHttpUrl(pick(row, FIELD_ALIASES.url));
  if (!title || !url) return undefined;

  const description = pick(row, FIELD_ALIASES.description);
  const id = pick(row, FIELD_ALIASES.id);
  const matchedReferences = matchReferences(`${title} ${description} ${url} ${id}`);
  if (matchedReferences.length === 0) return undefined;

  const stock = pick(row, FIELD_ALIASES.stock);
  const languageRaw = pick(row, FIELD_ALIASES.language);
  const seller = pick(row, FIELD_ALIASES.seller);
  const priceRaw = pick(row, FIELD_ALIASES.price);
  const eligibility = commercialEligibility(connector, seller);
  const context = `${title} ${description}`;
  const language = detectLanguage(`${languageRaw} ${title} ${description} ${url}`);
  const availability = explicitAvailability(stock || context);
  const extractedPrice = priceRaw ? extractPrice(`${priceRaw} €`) ?? extractPrice(priceRaw) : extractPrice(context);

  return enrichCandidateIdentity({
    store: connector.key,
    storeName: connector.name,
    title,
    url,
    sourceUrl: `authorized-feed:${connector.key}`,
    matchedReferences,
    externalId: id || undefined,
    seller: seller || undefined,
    availability,
    language,
    priceText: availability === "unavailable" ? undefined : extractedPrice,
    imageUrl: safeHttpUrl(pick(row, FIELD_ALIASES.image)),
    commercialEligible: eligibility.eligible,
    commercialEligibilityReason: eligibility.reason,
    excerpt: stripHtml(description || context).slice(0, 500)
  });
}

interface FeedTextProcessor {
  write(value: string): void;
  end(): void;
}

interface StreamedFeedResult {
  candidates: ProductCandidate[];
  productRowsSeen: number;
  responseBytes: number;
}

function feedFormat(contentType: string, prefix: string): "csv" | "json" | "xml" {
  const first = prefix.trimStart()[0];
  if (first === "<") return "xml";
  if (first === "[" || first === "{") return "json";
  if (/json/i.test(contentType)) return "json";
  if (/xml/i.test(contentType)) return "xml";
  return "csv";
}

function hasReferenceSignal(value: string): boolean {
  return /\b(?:OP|EB|ST|DP|TS|PRB)[\s_-]?\d{1,2}\b/i.test(value);
}

function createCsvStreamProcessor(accept: (row?: FeedRow) => void): FeedTextProcessor {
  let headers: string[] | undefined;
  let delimiter = ",";
  let recordParts: string[] = [];
  let recordChars = 0;
  let quoted = false;
  let pendingQuote = false;

  const append = (value: string): void => {
    if (!value) return;
    recordParts.push(value);
    recordChars += value.length;
    if (recordChars > MAX_FEED_RECORD_CHARS) throw new Error("Flux autorisé: enregistrement CSV anormalement volumineux");
  };

  const finishRecord = (): void => {
    const raw = recordParts.join("").replace(/^\uFEFF/, "").trim();
    recordParts = [];
    recordChars = 0;
    if (!raw || raw.startsWith("#")) return;
    if (!headers) {
      const delimiters = ["\t", ";", ",", "|"];
      delimiter = [...delimiters].sort((left, right) => scoreDelimiter(raw, right) - scoreDelimiter(raw, left))[0];
      headers = parseDelimitedLine(raw, delimiter).map(normalizeKey);
      if (headers.length < 2) throw new Error("Flux autorisé: en-tête CSV invalide");
      return;
    }
    // rowToCandidate rejetterait de toute façon ces lignes. Cette vérification
    // avant allocation garde un catalogue généraliste de 28 Mo peu coûteux.
    if (!hasReferenceSignal(raw)) {
      accept();
      return;
    }
    const values = parseDelimitedLine(raw, delimiter);
    const row: FeedRow = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? "";
    });
    accept(row);
  };

  return {
    write(value: string): void {
      let index = 0;
      let segmentStart = 0;
      if (pendingQuote) {
        if (value[0] === '"') {
          // Deux guillemets séparés par une frontière de chunk : échappement.
          index = 1;
        } else {
          quoted = false;
        }
        pendingQuote = false;
      }

      for (; index < value.length; index += 1) {
        const char = value[index];
        if (char === '"') {
          if (!quoted) {
            quoted = true;
          } else if (index + 1 < value.length && value[index + 1] === '"') {
            index += 1;
          } else if (index + 1 === value.length) {
            pendingQuote = true;
          } else {
            quoted = false;
          }
          continue;
        }
        if ((char === "\n" || char === "\r") && !quoted && !pendingQuote) {
          append(value.slice(segmentStart, index));
          finishRecord();
          if (char === "\r" && value[index + 1] === "\n") index += 1;
          segmentStart = index + 1;
        }
      }
      append(value.slice(segmentStart));
    },
    end(): void {
      if (pendingQuote) {
        pendingQuote = false;
        quoted = false;
      }
      if (quoted) throw new Error("Flux autorisé: guillemet CSV non fermé");
      finishRecord();
    }
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createXmlStreamProcessor(accept: (row?: FeedRow) => void): FeedTextProcessor {
  let buffer = "";

  const drain = (final: boolean): void => {
    while (buffer) {
      const opening = buffer.match(/<((?:[A-Za-z0-9_-]+:)?(?:product|item|article|offer|entry))\b[^>]*>/i);
      if (!opening || opening.index === undefined) {
        if (final) return;
        if (buffer.length > MAX_FEED_RECORD_CHARS) buffer = buffer.slice(-4_096);
        return;
      }
      if (opening.index > 0) buffer = buffer.slice(opening.index);
      const tag = opening[1];
      const bodyStart = opening[0].length;
      const closing = new RegExp(`<\\/${escapeRegExp(tag)}\\s*>`, "i").exec(buffer.slice(bodyStart));
      if (!closing || closing.index === undefined) {
        if (buffer.length > MAX_FEED_RECORD_CHARS) throw new Error("Flux autorisé: enregistrement XML anormalement volumineux");
        return;
      }
      const bodyEnd = bodyStart + closing.index;
      const raw = buffer.slice(bodyStart, bodyEnd);
      const consumed = bodyEnd + closing[0].length;
      buffer = buffer.slice(consumed);
      accept(hasReferenceSignal(raw) ? parseXmlFields(raw) : undefined);
    }
  };

  return {
    write(value: string): void {
      buffer += value;
      drain(false);
    },
    end(): void {
      drain(true);
    }
  };
}

function createJsonStreamProcessor(prefix: string, accept: (row?: FeedRow) => void): FeedTextProcessor {
  // Tableau racine : chaque objet de profondeur 1 est un produit. Objet
  // racine : compatibilité avec {products:[...]}/{items:[...]}/{results:[...]}.
  const targetObjectDepth = prefix.trimStart().startsWith("[") ? 1 : 2;
  let objectDepth = 0;
  let inString = false;
  let escaped = false;
  let capturing = false;
  let captureParts: string[] = [];
  let captureChars = 0;

  const appendCapture = (value: string): void => {
    if (!value) return;
    captureParts.push(value);
    captureChars += value.length;
    if (captureChars > MAX_FEED_RECORD_CHARS) throw new Error("Flux autorisé: objet JSON anormalement volumineux");
  };

  const finishCapture = (): void => {
    const raw = captureParts.join("");
    captureParts = [];
    captureChars = 0;
    const parsed = JSON.parse(raw) as unknown;
    const row = objectToRow(parsed);
    if (row) accept(hasReferenceSignal(raw) ? row : undefined);
  };

  return {
    write(value: string): void {
      let captureStart = capturing ? 0 : -1;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{") {
          objectDepth += 1;
          if (!capturing && objectDepth === targetObjectDepth) {
            capturing = true;
            captureStart = index;
          }
          continue;
        }
        if (char === "}") {
          if (capturing && objectDepth === targetObjectDepth) {
            appendCapture(value.slice(captureStart, index + 1));
            finishCapture();
            capturing = false;
            captureStart = -1;
          }
          objectDepth -= 1;
        }
      }
      if (capturing && captureStart >= 0) appendCapture(value.slice(captureStart));
    },
    end(): void {
      if (capturing || inString || objectDepth !== 0) throw new Error("Flux autorisé: JSON incomplet");
    }
  };
}

async function readAuthorizedFeedResponse(
  response: Response,
  connector: ConnectorDefinition
): Promise<StreamedFeedResult> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_TRANSFER_BYTES) {
    throw new Error(`Flux autorisé trop volumineux: ${declaredLength} octets`);
  }
  if (!response.body) throw new Error("Flux autorisé: corps de réponse absent");

  const candidates: ProductCandidate[] = [];
  let productRowsSeen = 0;
  let responseBytes = 0;
  const accept = (row?: FeedRow): void => {
    productRowsSeen += 1;
    if (!row) return;
    const candidate = rowToCandidate(row, connector);
    if (!candidate) return;
    if (candidates.length >= MAX_FEED_CANDIDATES) {
      throw new Error(`Flux autorisé: plus de ${MAX_FEED_CANDIDATES} produits One Piece qualifiables`);
    }
    candidates.push(candidate);
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const contentType = response.headers.get("content-type") ?? "";
  let prefix = "";
  let processor: FeedTextProcessor | undefined;

  const consumeText = (text: string): void => {
    if (!text) return;
    if (!processor) {
      prefix += text;
      if (!prefix.trim() && prefix.length < 65_536) return;
      const format = feedFormat(contentType, prefix);
      processor = format === "xml"
        ? createXmlStreamProcessor(accept)
        : format === "json"
          ? createJsonStreamProcessor(prefix, accept)
          : createCsvStreamProcessor(accept);
      const initial = prefix;
      prefix = "";
      processor.write(initial);
      return;
    }
    processor.write(text);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseBytes += value.byteLength;
      if (responseBytes > MAX_FEED_TRANSFER_BYTES) {
        throw new Error(`Flux autorisé trop volumineux: plus de ${MAX_FEED_TRANSFER_BYTES} octets`);
      }
      consumeText(decoder.decode(value, { stream: true }));
    }
    consumeText(decoder.decode());
    processor?.end();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!processor || productRowsSeen === 0) throw new Error("Flux autorisé lisible mais aucun produit structuré détecté");
  return { candidates, productRowsSeen, responseBytes };
}

export async function auditAuthorizedFeed(
  connector: ConnectorDefinition,
  feedUrl: string,
  options: { stateStore?: StateStore; forceRefresh?: boolean } = {}
): Promise<StoreAudit> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const safeSourceUrl = `authorized-feed:${connector.key}`;

  try {
    const parsedFeedUrl = new URL(feedUrl);
    if (
      parsedFeedUrl.protocol !== "https:" ||
      parsedFeedUrl.username ||
      parsedFeedUrl.password ||
      privateOrLocalHostname(parsedFeedUrl.hostname)
    ) {
      throw new Error("L'URL du flux autorisé doit utiliser HTTPS");
    }
    const sourceHash = fnv1a(feedUrl);
    const revalidationMetadataKey = `${REVALIDATION_METADATA_PREFIX}:${connector.key}`;
    const previousValidation = await readRevalidationState(
      options.stateStore,
      revalidationMetadataKey,
      sourceHash
    );
    const headers: Record<string, string> = {
      "User-Agent": "OPWatch/1.0 (+authorized publisher product-feed consumer)",
      "Accept": "text/csv,text/tab-separated-values,application/json,application/xml,text/xml;q=0.9,*/*;q=0.5"
    };
    if (!options.forceRefresh && previousValidation?.etag) headers["If-None-Match"] = previousValidation.etag;
    if (!options.forceRefresh && previousValidation?.lastModified) headers["If-Modified-Since"] = previousValidation.lastModified;
    const response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers
    });
    const finalFeedUrl = new URL(response.url || feedUrl);
    if (finalFeedUrl.protocol !== "https:" || privateOrLocalHostname(finalFeedUrl.hostname)) {
      throw new Error("Redirection du flux autorisé vers une destination non sûre");
    }
    if (response.status === 304) {
      if (!previousValidation) throw new Error("Flux autorisé HTTP 304 sans baseline locale");
      return {
        store: connector.key,
        storeName: connector.name,
        checkedAt: new Date().toISOString(),
        sources: [{
          sourceUrl: safeSourceUrl,
          finalUrl: safeSourceUrl,
          status: response.status,
          responseBytes: 0,
          durationMs: Math.round(performance.now() - started),
          cacheValidation: cacheValidationKind(previousValidation),
          notModified: true,
          productLinksSeen: 0,
          candidates: []
        }],
        candidates: [],
        notes: [
          ...connector.notes,
          "Source commerciale: flux produit autorisé inchangé (HTTP 304, URL secrète non exposée)."
        ]
      };
    }
    if (!response.ok) throw new Error(`Flux autorisé HTTP ${response.status}`);
    const streamed = await readAuthorizedFeedResponse(response, connector);
    const nextValidation: FeedRevalidationState = {
      sourceHash,
      baseline: true,
      ...(safeValidator(response.headers.get("etag")) ? { etag: safeValidator(response.headers.get("etag")) } : {}),
      ...(safeValidator(response.headers.get("last-modified")) ? { lastModified: safeValidator(response.headers.get("last-modified")) } : {})
    };
    await persistRevalidationState(options.stateStore, revalidationMetadataKey, nextValidation);

    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [{
        sourceUrl: safeSourceUrl,
        finalUrl: safeSourceUrl,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        responseBytes: streamed.responseBytes,
        durationMs: Math.round(performance.now() - started),
        cacheValidation: cacheValidationKind(nextValidation),
        productLinksSeen: streamed.productRowsSeen,
        candidates: streamed.candidates
      }],
      candidates: streamed.candidates,
      notes: [...connector.notes, "Source commerciale: flux produit autorisé (URL secrète non exposée dans les audits)."]
    };
  } catch (error) {
    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [{
        sourceUrl: safeSourceUrl,
        durationMs: Math.round(performance.now() - started),
        productLinksSeen: 0,
        candidates: [],
        error: safeFeedError(error)
      }],
      candidates: [],
      notes: connector.notes
    };
  } finally {
    clearTimeout(timeout);
  }
}
