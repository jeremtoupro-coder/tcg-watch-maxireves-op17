export type StoreKey = "maxireves" | "ludotrotter" | "oupi" | "fantasy-sphere";

export type Availability = "available" | "preorder" | "unavailable" | "unknown";

export type LanguageStatus =
  | "Français confirmé"
  | "Langue non précisée"
  | "Anglais détecté"
  | "Japonais détecté"
  | "Autre langue détectée";

export type AlertEventType =
  | "new_listing"
  | "back_in_stock"
  | "preorder_opened"
  | "price_drop"
  | "price_increase"
  | "became_unavailable"
  | "details_changed";

export interface ProductDefinition {
  id: string;
  label: string;
  enabled: boolean;
  aliases: string[];
}

export interface AlertRule {
  id: string;
  label: string;
  enabled: boolean;
  productIds: string[];
  stores: Array<StoreKey | "*">;
  languages: Array<LanguageStatus | "*">;
  events: AlertEventType[];
  availabilities: Array<Availability | "*">;
  notifyOnInitialDiscovery: boolean;
  maxPriceCents?: number;
}

export interface WatchConfig {
  version: number;
  settings: {
    notifyOnInitialDiscovery: boolean;
    defaultLanguages: LanguageStatus[];
  };
  products: ProductDefinition[];
  alerts: AlertRule[];
}

export interface ProductCandidate {
  store: StoreKey;
  storeName: string;
  title: string;
  url: string;
  sourceUrl: string;
  matchedReferences: string[];
  availability: Availability;
  language: LanguageStatus;
  priceText?: string;
  excerpt: string;
}

export interface ProductSnapshot {
  key: string;
  store: StoreKey;
  storeName: string;
  title: string;
  url: string;
  matchedReferences: string[];
  availability: Availability;
  language: LanguageStatus;
  priceText?: string;
  priceCents?: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProductChange {
  id: string;
  type: AlertEventType;
  initial: boolean;
  detectedAt: string;
  candidate: ProductCandidate;
  previous?: ProductSnapshot;
  current: ProductSnapshot;
}

export interface AlertMatch {
  rule: AlertRule;
  change: ProductChange;
  matchedProductIds: string[];
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordPayload {
  username: string;
  embeds: Array<{
    title: string;
    url: string;
    description: string;
    fields: DiscordEmbedField[];
    footer: { text: string };
    timestamp: string;
  }>;
}

export interface SourceAudit {
  sourceUrl: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  responseBytes?: number;
  durationMs: number;
  etag?: string;
  lastModified?: string;
  productLinksSeen: number;
  candidates: ProductCandidate[];
  error?: string;
}

export interface StoreAudit {
  store: StoreKey;
  storeName: string;
  checkedAt: string;
  sources: SourceAudit[];
  candidates: ProductCandidate[];
  notes: string[];
}

export interface ConnectorDefinition {
  key: StoreKey;
  name: string;
  sources: string[];
  productUrlPatterns: RegExp[];
  notes: string[];
}

export interface Env {
  AUDIT_MODE?: string;
  ALLOW_PUBLIC_AUDIT?: string;
  WRITE_STATE?: string;
  DISCORD_MODE?: "dry-run" | "live";
  DISCORD_WEBHOOK_URL?: string;
  TCG_STATE?: KVNamespace;
}
