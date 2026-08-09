import { detectAvailability, detectLanguage, extractPrice, matchReferences, stripHtml } from "./matching";
import { enrichCandidateIdentity } from "./opwatchV1";
import type { Availability, ConnectorDefinition, ProductCandidate, StoreAudit } from "./types";

const MAX_FEED_BYTES = 5_000_000;
const FEED_TIMEOUT_MS = 25_000;

type FeedRow = Record<string, string>;

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

export async function auditAuthorizedFeed(
  connector: ConnectorDefinition,
  feedUrl: string
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
    const response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch/1.0 (+authorized publisher product-feed consumer)",
        "Accept": "text/csv,text/tab-separated-values,application/json,application/xml,text/xml;q=0.9,*/*;q=0.5"
      }
    });
    const finalFeedUrl = new URL(response.url || feedUrl);
    if (finalFeedUrl.protocol !== "https:" || privateOrLocalHostname(finalFeedUrl.hostname)) {
      throw new Error("Redirection du flux autorisé vers une destination non sûre");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_FEED_BYTES) throw new Error(`Flux autorisé trop volumineux: ${body.byteLength} octets`);
    if (!response.ok) throw new Error(`Flux autorisé HTTP ${response.status}`);
    const raw = new TextDecoder("utf-8").decode(body);
    const rows = parseAuthorizedFeed(raw, response.headers.get("content-type") ?? "");
    if (rows.length === 0) throw new Error("Flux autorisé lisible mais aucun produit structuré détecté");
    const candidates = rows
      .map((row) => rowToCandidate(row, connector))
      .filter((candidate): candidate is ProductCandidate => Boolean(candidate));

    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [{
        sourceUrl: safeSourceUrl,
        finalUrl: safeSourceUrl,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        responseBytes: body.byteLength,
        durationMs: Math.round(performance.now() - started),
        productLinksSeen: rows.length,
        candidates
      }],
      candidates,
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
