import type { OfficialProduct, ProductFamily } from "./opwatchV1";
import type { LanguageStatus, StoreKey } from "./types";

export const CONTROL_CONFIG_STORAGE_KEY = "cockpit:control-config:v1";
export const COCKPIT_LANGUAGES: LanguageStatus[] = [
  "Français confirmé",
  "Anglais détecté",
  "Japonais détecté"
];

export interface CockpitProductOverride {
  enabled?: boolean;
  stopAt?: string;
}

export interface CockpitManualProduct {
  id: string;
  label: string;
  game: string;
  aliases: string[];
  enabled: boolean;
  releaseDate: string;
  startsAt?: string;
  stopAt?: string;
  storeUrls: Partial<Record<StoreKey, string[]>>;
}

export interface CockpitAssistantSource {
  title: string;
  url: string;
}

export interface CockpitAssistantRequest {
  id: string;
  createdAt: string;
  completedAt?: string;
  text: string;
  status: "pending" | "done" | "cancelled" | "error";
  answer?: string;
  model?: string;
  responseId?: string;
  error?: string;
  sources?: CockpitAssistantSource[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface RuntimeControlConfig {
  version: 1;
  updatedAt: string;
  languages: LanguageStatus[];
  productOverrides: Record<string, CockpitProductOverride>;
  manualProducts: CockpitManualProduct[];
  assistantRequests: CockpitAssistantRequest[];
}

function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeId(value: unknown): string {
  return cleanText(value, 80).toUpperCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => cleanText(value, maxLength))
    .filter((value) => value.length >= 2))]
    .slice(0, maxItems);
}

function normalizedStoreUrls(value: unknown): Partial<Record<StoreKey, string[]>> {
  if (!value || typeof value !== "object") return {};
  const output: Partial<Record<StoreKey, string[]>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    const urls = [...new Set(raw.flatMap((item) => {
      if (typeof item !== "string") return [];
      try {
        const parsed = new URL(item.trim());
        return parsed.protocol === "https:" && !parsed.username && !parsed.password ? [parsed.toString()] : [];
      } catch {
        return [];
      }
    }))].slice(0, 12);
    if (urls.length) output[key] = urls;
  }
  return output;
}

function normalizedAssistantSources(value: unknown): CockpitAssistantSource[] {
  if (!Array.isArray(value)) return [];
  const sources = new Map<string, CockpitAssistantSource>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<CockpitAssistantSource>;
    try {
      const parsed = new URL(cleanText(item.url, 2000));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
      const source = {
        title: cleanText(item.title, 200) || parsed.hostname,
        url: parsed.toString()
      };
      sources.set(source.url, source);
    } catch {
      // Ignore une citation malformée plutôt que de casser l'historique.
    }
  }
  return [...sources.values()].slice(0, 12);
}

function normalizedAssistantUsage(value: unknown): CockpitAssistantRequest["usage"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const number = (item: unknown): number | undefined =>
    typeof item === "number" && Number.isFinite(item) && item >= 0 ? Math.floor(item) : undefined;
  const usage = {
    inputTokens: number(raw.inputTokens),
    outputTokens: number(raw.outputTokens),
    totalTokens: number(raw.totalTokens)
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

export function defaultRuntimeControlConfig(now = new Date()): RuntimeControlConfig {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    languages: ["Français confirmé"],
    productOverrides: {},
    manualProducts: [],
    assistantRequests: []
  };
}

export function normalizeRuntimeControlConfig(raw: unknown, now = new Date()): RuntimeControlConfig {
  const fallback = defaultRuntimeControlConfig(now);
  if (!raw || typeof raw !== "object") return fallback;
  const input = raw as Partial<RuntimeControlConfig>;
  const languages = uniqueStrings(input.languages, 3, 40)
    .filter((language): language is LanguageStatus => COCKPIT_LANGUAGES.includes(language as LanguageStatus));

  const productOverrides: Record<string, CockpitProductOverride> = {};
  if (input.productOverrides && typeof input.productOverrides === "object") {
    for (const [rawId, rawOverride] of Object.entries(input.productOverrides)) {
      const id = normalizeId(rawId);
      if (!id || !rawOverride || typeof rawOverride !== "object") continue;
      const override = rawOverride as CockpitProductOverride;
      productOverrides[id] = {
        ...(typeof override.enabled === "boolean" ? { enabled: override.enabled } : {}),
        ...(validIsoDate(override.stopAt) ? { stopAt: override.stopAt } : {})
      };
    }
  }

  const manualProducts = Array.isArray(input.manualProducts)
    ? input.manualProducts.flatMap((raw): CockpitManualProduct[] => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Partial<CockpitManualProduct>;
        const id = normalizeId(item.id);
        const label = cleanText(item.label, 180);
        const game = cleanText(item.game, 60) || "other";
        const releaseDate = validIsoDate(item.releaseDate) ? item.releaseDate : todayUtc(now);
        if (!id || !label) return [];
        const aliases = [...new Set([id, ...uniqueStrings(item.aliases, 20, 120)])].slice(0, 20);
        return [{
          id,
          label,
          game,
          aliases,
          enabled: item.enabled !== false,
          releaseDate,
          ...(validIsoDate(item.startsAt) ? { startsAt: item.startsAt } : {}),
          ...(validIsoDate(item.stopAt) ? { stopAt: item.stopAt } : {}),
          storeUrls: normalizedStoreUrls(item.storeUrls)
        }];
      }).slice(0, 100)
    : [];

  const assistantRequests = Array.isArray(input.assistantRequests)
    ? input.assistantRequests.flatMap((raw): CockpitAssistantRequest[] => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Partial<CockpitAssistantRequest>;
        const id = cleanText(item.id, 80);
        const text = cleanText(item.text, 4000);
        const status = item.status;
        if (!id || !text || !["pending", "done", "cancelled", "error"].includes(status ?? "")) return [];
        const sources = normalizedAssistantSources(item.sources);
        const usage = normalizedAssistantUsage(item.usage);
        return [{
          id,
          text,
          status: status as CockpitAssistantRequest["status"],
          createdAt: typeof item.createdAt === "string" ? item.createdAt : now.toISOString(),
          ...(typeof item.completedAt === "string" ? { completedAt: item.completedAt } : {}),
          ...(cleanText(item.answer, 12000) ? { answer: cleanText(item.answer, 12000) } : {}),
          ...(cleanText(item.model, 120) ? { model: cleanText(item.model, 120) } : {}),
          ...(cleanText(item.responseId, 160) ? { responseId: cleanText(item.responseId, 160) } : {}),
          ...(cleanText(item.error, 800) ? { error: cleanText(item.error, 800) } : {}),
          ...(sources.length ? { sources } : {}),
          ...(usage ? { usage } : {})
        }];
      }).slice(-50)
    : [];

  return {
    version: 1,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now.toISOString(),
    languages: languages.length ? languages : ["Français confirmé"],
    productOverrides,
    manualProducts,
    assistantRequests
  };
}

function familyForManualProduct(id: string): ProductFamily {
  const prefix = id.match(/^([A-Z]+)[-\s]?\d{1,3}$/)?.[1];
  return prefix && ["OP", "EB", "PRB", "ST", "DP", "TS"].includes(prefix)
    ? prefix as ProductFamily
    : "OTHER";
}

function productIsWithinManualWindow(product: CockpitManualProduct, now: Date): boolean {
  const today = todayUtc(now);
  if (!product.enabled) return false;
  if (product.startsAt && today < product.startsAt) return false;
  if (product.stopAt && today > product.stopAt) return false;
  return true;
}

export function applyRuntimeControlConfig(
  officialActiveProducts: OfficialProduct[],
  config: RuntimeControlConfig,
  now = new Date()
): OfficialProduct[] {
  const today = todayUtc(now);
  const products = new Map<string, OfficialProduct>();

  for (const product of officialActiveProducts) {
    const id = normalizeId(product.id);
    const override = config.productOverrides[id];
    if (override?.enabled === false) continue;
    if (override?.stopAt && today > override.stopAt) continue;
    products.set(id, { ...product, id });
  }

  for (const manual of config.manualProducts) {
    if (!productIsWithinManualWindow(manual, now)) continue;
    const override = config.productOverrides[manual.id];
    if (override?.enabled === false) continue;
    if (override?.stopAt && today > override.stopAt) continue;
    const existing = products.get(manual.id);
    products.set(manual.id, {
      id: manual.id,
      family: familyForManualProduct(manual.id),
      label: manual.label,
      releaseDate: manual.releaseDate,
      aliases: [...new Set([...(existing?.aliases ?? []), ...manual.aliases])]
    });
  }

  return [...products.values()].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id));
}

export function extraStoreSources(config: RuntimeControlConfig): Partial<Record<StoreKey, string[]>> {
  const output: Partial<Record<StoreKey, string[]>> = {};
  for (const product of config.manualProducts) {
    if (!product.enabled) continue;
    for (const [store, urls] of Object.entries(product.storeUrls)) {
      if (!urls?.length) continue;
      output[store] = [...new Set([...(output[store] ?? []), ...urls])];
    }
  }
  return output;
}
