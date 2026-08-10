import { matchReferences } from "./matching";
import { enrichCandidateIdentity } from "./opwatchV1";
import type { ConnectorDefinition, ProductCandidate, StoreAudit } from "./types";

const PARKAGE_CATALOG_URL = "https://back.parkage.com/api/parkage/search/get?category_id=9883&complete=true&count=true&limit=50&offset=0&text=&preorder=&isnew=&lang=fr&with_quantity=false&isDiscount=false&order=relevance&direction=DESC";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1_500_000;

interface ParkageProduct {
  id?: unknown;
  name?: unknown;
  name_fr?: unknown;
  name_en?: unknown;
  lang?: unknown;
  price?: unknown;
  price_discount?: unknown;
  stock?: unknown;
  is_preorder?: unknown;
  preorder?: unknown;
}

interface ParkageResponse {
  type?: unknown;
  data?: { list?: unknown };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function directProductUrl(id: number, title: string): string {
  return `https://www.parkage.com/fr/${id}-${slugify(title) || "one-piece-card-game"}`;
}

function priceText(value: unknown): string | undefined {
  const price = number(value);
  if (price === undefined || price < 0) return undefined;
  return `${price.toFixed(2).replace(".", ",")} €`;
}

function isPreorder(product: ParkageProduct): boolean {
  return product.is_preorder === true || product.is_preorder === 1 || product.is_preorder === "1" ||
    product.preorder === true || product.preorder === 1 || product.preorder === "1";
}

function toCandidate(product: ParkageProduct, connector: ConnectorDefinition): ProductCandidate | undefined {
  const id = number(product.id);
  const title = text(product.name_fr) || text(product.name);
  const lang = text(product.lang).toLowerCase();
  if (!id || !title || lang !== "fr") return undefined;

  const url = directProductUrl(id, title);
  const matchedReferences = matchReferences(`${title} ${text(product.name_en)} ${url}`);
  if (matchedReferences.length === 0) return undefined;

  const stock = number(product.stock);
  const preorder = isPreorder(product);
  const availability = preorder ? "preorder" as const : stock === undefined
    ? "unknown" as const
    : stock > 0 ? "available" as const : "unavailable" as const;

  return enrichCandidateIdentity({
    store: connector.key,
    storeName: connector.name,
    title,
    url,
    sourceUrl: PARKAGE_CATALOG_URL,
    matchedReferences,
    externalId: String(id),
    availability,
    language: "Français confirmé",
    priceText: priceText(product.price),
    commercialEligible: true,
    excerpt: `Catalogue public Parkage FR • stock=${stock ?? "inconnu"}`
  });
}

export async function auditParkagePublicCatalog(connector: ConnectorDefinition): Promise<StoreAudit> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status: number | undefined;
  let contentType: string | undefined;
  let responseBytes: number | undefined;

  try {
    const response = await fetch(PARKAGE_CATALOG_URL, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
        "Accept": "application/json",
        "Accept-Language": "fr-FR,fr;q=0.9"
      }
    });
    status = response.status;
    contentType = response.headers.get("content-type") ?? undefined;
    const body = await response.arrayBuffer();
    responseBytes = body.byteLength;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (responseBytes > MAX_RESPONSE_BYTES) throw new Error(`Réponse Parkage trop volumineuse: ${responseBytes} octets`);

    let parsed: ParkageResponse;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8").decode(body)) as ParkageResponse;
    } catch {
      throw new Error("API publique Parkage: JSON invalide");
    }
    const list = parsed.data?.list;
    if (!Array.isArray(list)) throw new Error("API publique Parkage: liste produits absente");

    const candidates = list
      .map((item) => toCandidate(item as ParkageProduct, connector))
      .filter((candidate): candidate is ProductCandidate => Boolean(candidate));

    if (list.length === 0) throw new Error("API publique Parkage: catalogue FR vide de façon inattendue");

    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [{
        sourceUrl: PARKAGE_CATALOG_URL,
        finalUrl: response.url || PARKAGE_CATALOG_URL,
        status,
        contentType,
        responseBytes,
        durationMs: Math.round(performance.now() - started),
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        productLinksSeen: list.length,
        candidates
      }],
      candidates,
      notes: [
        ...connector.notes,
        "Source commerciale: API catalogue publique utilisée par le frontend Parkage, filtrée en français et lue sans authentification."
      ]
    };
  } catch (error) {
    return {
      store: connector.key,
      storeName: connector.name,
      checkedAt: new Date().toISOString(),
      sources: [{
        sourceUrl: PARKAGE_CATALOG_URL,
        status,
        contentType,
        responseBytes,
        durationMs: Math.round(performance.now() - started),
        productLinksSeen: 0,
        candidates: [],
        error: error instanceof Error && error.name === "AbortError"
          ? "API publique Parkage: délai réseau dépassé"
          : error instanceof Error ? error.message : String(error)
      }],
      candidates: [],
      notes: connector.notes
    };
  } finally {
    clearTimeout(timeout);
  }
}
