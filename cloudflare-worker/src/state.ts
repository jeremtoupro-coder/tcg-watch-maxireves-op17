import type {
  Env,
  ProductCandidate,
  ProductChange,
  ProductSnapshot,
  StoreKey
} from "./types";

export interface StateStore {
  readonly mode: "memory" | "kv" | "cloudflare-api";
  readonly writable: boolean;
  get(key: string): Promise<ProductSnapshot | undefined>;
  put(key: string, value: ProductSnapshot): Promise<void>;
  getMetadata(key: string): Promise<string | undefined>;
  putMetadata(key: string, value: string): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  readonly mode = "memory" as const;
  readonly writable: boolean;
  private readonly values = new Map<string, ProductSnapshot>();
  private readonly metadata = new Map<string, string>();

  constructor(options: {
    writable?: boolean;
    seed?: ProductSnapshot[];
    seedMetadata?: Record<string, string>;
  } = {}) {
    this.writable = options.writable ?? true;
    for (const snapshot of options.seed ?? []) {
      this.values.set(snapshot.key, snapshot);
    }
    for (const [key, value] of Object.entries(options.seedMetadata ?? {})) {
      this.metadata.set(key, value);
    }
  }

  async get(key: string): Promise<ProductSnapshot | undefined> {
    return this.values.get(key);
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    if (!this.writable) return;
    this.values.set(key, value);
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return this.metadata.get(key);
  }

  async putMetadata(key: string, value: string): Promise<void> {
    if (!this.writable) return;
    this.metadata.set(key, value);
  }
}

export class KvStateStore implements StateStore {
  readonly mode = "kv" as const;

  constructor(
    private readonly namespace: KVNamespace,
    readonly writable: boolean
  ) {}

  async get(key: string): Promise<ProductSnapshot | undefined> {
    const value = await this.namespace.get<ProductSnapshot>(key, "json");
    return value ?? undefined;
  }

  async put(key: string, value: ProductSnapshot): Promise<void> {
    if (!this.writable) return;
    await this.namespace.put(key, JSON.stringify(value));
  }

  async getMetadata(key: string): Promise<string | undefined> {
    return (await this.namespace.get(`metadata:${key}`)) ?? undefined;
  }

  async putMetadata(key: string, value: string): Promise<void> {
    if (!this.writable) return;
    await this.namespace.put(`metadata:${key}`, value);
  }
}

export function createStateStore(env: Env): StateStore {
  const writable = env.WRITE_STATE === "true";
  if (env.TCG_STATE) return new KvStateStore(env.TCG_STATE, writable);

  return new MemoryStateStore({ writable: false });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function productStateKey(candidate: ProductCandidate): string {
  return `product:${candidate.store}:${fnv1a(candidate.url)}`;
}

export function parseEuroPriceToCents(priceText?: string): number | undefined {
  if (!priceText) return undefined;

  let value = priceText
    .replace(/€/g, "")
    .replace(/[\s\u00a0]/g, "")
    .replace(/[^0-9.,]/g, "");

  if (!value) return undefined;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  let decimalSeparator: "," | "." | undefined;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    decimalSeparator = value.length - lastComma - 1 === 2 ? "," : undefined;
  } else if (lastDot >= 0) {
    decimalSeparator = value.length - lastDot - 1 === 2 ? "." : undefined;
  }

  if (decimalSeparator) {
    const separatorIndex = value.lastIndexOf(decimalSeparator);
    const integerPart = value.slice(0, separatorIndex).replace(/[.,]/g, "");
    const decimalPart = value.slice(separatorIndex + 1).replace(/[.,]/g, "").padEnd(2, "0").slice(0, 2);
    value = `${integerPart}.${decimalPart}`;
  } else {
    value = value.replace(/[.,]/g, "");
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

export function toSnapshot(
  candidate: ProductCandidate,
  previous: ProductSnapshot | undefined,
  now: string
): ProductSnapshot {
  return {
    key: productStateKey(candidate),
    store: candidate.store,
    storeName: candidate.storeName,
    title: candidate.title,
    url: candidate.url,
    matchedReferences: [...candidate.matchedReferences].sort(),
    availability: candidate.availability,
    language: candidate.language,
    priceText: candidate.priceText,
    priceCents: parseEuroPriceToCents(candidate.priceText),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now
  };
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function detectProductChanges(
  candidate: ProductCandidate,
  previous: ProductSnapshot | undefined,
  now = new Date().toISOString(),
  initialDiscovery = true
): { current: ProductSnapshot; changes: ProductChange[] } {
  const current = toSnapshot(candidate, previous, now);
  const changes: ProductChange[] = [];

  const addChange = (type: ProductChange["type"], initial = false): void => {
    changes.push({
      id: `${current.key}:${type}:${now}`,
      type,
      initial,
      detectedAt: now,
      candidate,
      previous,
      current
    });
  };

  if (!previous) {
    addChange("new_listing", initialDiscovery);
    return { current, changes };
  }

  if (
    current.availability === "available" &&
    previous.availability !== "available"
  ) {
    addChange("back_in_stock");
  }

  if (
    current.availability === "preorder" &&
    previous.availability !== "preorder"
  ) {
    addChange("preorder_opened");
  }

  if (
    current.availability === "unavailable" &&
    (previous.availability === "available" || previous.availability === "preorder")
  ) {
    addChange("became_unavailable");
  }

  if (
    current.priceCents !== undefined &&
    previous.priceCents !== undefined &&
    current.priceCents !== previous.priceCents
  ) {
    addChange(current.priceCents < previous.priceCents ? "price_drop" : "price_increase");
  }

  const detailsChanged =
    current.title !== previous.title ||
    current.language !== previous.language ||
    !sameStringArray(current.matchedReferences, previous.matchedReferences);

  if (detailsChanged) addChange("details_changed");

  return { current, changes };
}

export async function processCandidates(
  candidates: ProductCandidate[],
  store: StateStore,
  options: {
    writeState: boolean;
    now?: string;
    initialBaselineByStore?: Partial<Record<StoreKey, boolean>>;
  }
): Promise<{
  changes: ProductChange[];
  snapshots: ProductSnapshot[];
  uniqueCandidates: number;
  stateWrites: number;
}> {
  const unique = new Map<string, ProductCandidate>();
  for (const candidate of candidates) {
    unique.set(productStateKey(candidate), candidate);
  }

  const changes: ProductChange[] = [];
  const snapshots: ProductSnapshot[] = [];
  let stateWrites = 0;
  const now = options.now ?? new Date().toISOString();

  for (const [key, candidate] of unique.entries()) {
    const previous = await store.get(key);
    const initialDiscovery = options.initialBaselineByStore?.[candidate.store] ?? true;
    const result = detectProductChanges(candidate, previous, now, initialDiscovery);
    changes.push(...result.changes);
    snapshots.push(result.current);

    if (options.writeState && store.writable) {
      await store.put(key, result.current);
      stateWrites += 1;
    }
  }

  return {
    changes,
    snapshots,
    uniqueCandidates: unique.size,
    stateWrites
  };
}
