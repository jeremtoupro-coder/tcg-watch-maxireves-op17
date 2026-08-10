import { auditConnector } from "./audit";
import { decodeHtml, matchReferences, normalizeForMatching } from "./matching";
import type { OfficialProduct } from "./opwatchV1";
import type { ConnectorDefinition, SourceAudit, StoreAudit } from "./types";

const RSS_URL = "https://www.philibertnet.com/modules/feeder/rss.php?id_category=15860";
const RSS_TIMEOUT_MS = 15_000;
const RSS_MAX_BYTES = 500_000;
const MAX_ACTIVE_DIRECT_PAGES = 8;

function stripXmlMarkup(value: string): string {
  return decodeHtml(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripXmlMarkup(match[1]) : "";
}

function matchedActiveProductIds(value: string, watchProducts: OfficialProduct[]): string[] {
  const normalized = normalizeForMatching(value);
  const genericReferences = new Set(matchReferences(value));
  const matched: string[] = [];

  for (const product of watchProducts) {
    if (genericReferences.has(product.id) || product.aliases.some((alias) => {
      const candidate = normalizeForMatching(alias);
      return candidate.length >= 3 && normalized.includes(candidate);
    })) {
      matched.push(product.id);
    }
  }
  return [...new Set(matched)];
}

function parseActiveProductUrls(xml: string, watchProducts: OfficialProduct[]): string[] {
  const urls: string[] = [];
  for (const itemMatch of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const item = itemMatch[0];
    const title = tagValue(item, "title");
    const link = tagValue(item, "link");
    if (!title || !link || matchedActiveProductIds(`${title} ${link}`, watchProducts).length === 0) continue;
    try {
      const url = new URL(link);
      if (!/(?:^|\.)philibertnet\.com$/i.test(url.hostname)) continue;
      urls.push(url.toString());
    } catch {
      // Une entrée RSS invalide est simplement ignorée ; le flux lui-même reste sain.
    }
  }
  return [...new Set(urls)].slice(0, MAX_ACTIVE_DIRECT_PAGES);
}

function configuredDirectProductUrls(connector: ConnectorDefinition): string[] {
  return connector.sources.filter((source) =>
    connector.productUrlPatterns.some((pattern) => pattern.test(source))
  );
}

async function fetchRss(): Promise<{ source: SourceAudit; xml?: string }> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  let status: number | undefined;
  let contentType: string | undefined;
  let responseBytes: number | undefined;

  try {
    const response = await fetch(RSS_URL, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
        "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.4",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
      }
    });
    status = response.status;
    contentType = response.headers.get("content-type") ?? undefined;
    const body = await response.arrayBuffer();
    responseBytes = body.byteLength;
    if (responseBytes > RSS_MAX_BYTES) throw new Error(`RSS Philibert trop volumineux: ${responseBytes} octets`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = new TextDecoder("utf-8").decode(body);
    if (!/<rss\b/i.test(xml) || !/<item\b/i.test(xml) || !/one[\s-]*piece/i.test(stripXmlMarkup(xml))) {
      throw new Error("RSS Philibert One Piece invalide ou contenu métier absent");
    }
    return {
      xml,
      source: {
        sourceUrl: RSS_URL,
        finalUrl: response.url || RSS_URL,
        status,
        contentType,
        responseBytes,
        durationMs: Math.round(performance.now() - started),
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        productLinksSeen: (xml.match(/<item\b/gi) ?? []).length,
        candidates: []
      }
    };
  } catch (error) {
    return {
      source: {
        sourceUrl: RSS_URL,
        status,
        contentType,
        responseBytes,
        durationMs: Math.round(performance.now() - started),
        productLinksSeen: 0,
        candidates: [],
        error: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Philibert expose un RSS public par catégorie. On l'utilise comme discovery
 * légère et stable, puis on ne relit que les fiches directes correspondant aux
 * références actuellement actives. La grosse page de catégorie HTML n'entre
 * plus dans le chemin critique et un 403 sur celle-ci ne peut donc plus mettre
 * artificiellement toute la boutique en incident.
 */
export async function auditPhilibertPublicCatalog(
  connector: ConnectorDefinition,
  watchProducts: OfficialProduct[] = []
): Promise<StoreAudit> {
  const rss = await fetchRss();
  if (!rss.xml) {
    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [rss.source],
      candidates: [],
      notes: connector.notes
    };
  }

  const rssUrls = parseActiveProductUrls(rss.xml, watchProducts);
  const directUrls = [...new Set([
    ...rssUrls,
    ...configuredDirectProductUrls(connector)
  ])].slice(0, MAX_ACTIVE_DIRECT_PAGES);

  if (directUrls.length === 0) {
    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [rss.source],
      candidates: [],
      notes: connector.notes
    };
  }

  const directAudit = await auditConnector({
    ...connector,
    sources: directUrls,
    followDiscoveredProductPages: false,
    authoritativeStructuredFeed: false,
    maxConcurrency: 1
  }, watchProducts);

  return {
    store: connector.key,
    storeName: connector.name,
    checkedAt: new Date().toISOString(),
    sources: [rss.source, ...directAudit.sources],
    candidates: directAudit.candidates,
    notes: connector.notes
  };
}
