export type StoreKey = string;

export type Availability = "available" | "preorder" | "unavailable" | "unknown";

export type ProductFormat = "booster" | "display" | "case" | "double_pack" | "starter" | "other";

export type WatchScope = "new_releases" | "one_piece_all";

export type StoreConfiguredStatus =
  | "active_fast_watch"
  | "discovery_only"
  | "pending_authorized_feed"
  | "disabled";

export type StoreRuntimeStatus = "healthy" | "degraded" | "pending" | "disabled";

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
  game?: string;
  enabled: boolean;
  aliases: string[];
  searchTerms?: string[];
}

export interface AlertRule {
  id: string;
  label: string;
  enabled: boolean;
  /**
   * Permet de distinguer clairement les alertes issues du calendrier officiel
   * des restocks du catalogue historique. Les anciennes règles sans scope
   * restent interprétées comme `new_releases` pour compatibilité.
   */
  scope?: WatchScope;
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
  format?: ProductFormat;
  /** Identité commerciale stable, indépendante d'une éventuelle réécriture d'URL. */
  identityKey?: string;
  externalId?: string;
  seller?: string;
  availability: Availability;
  language: LanguageStatus;
  priceText?: string;
  imageUrl?: string;
  commercialEligible?: boolean;
  commercialEligibilityReason?: string;
  excerpt: string;
}

export interface ProductSnapshot {
  key: string;
  store: StoreKey;
  storeName: string;
  title: string;
  url: string;
  matchedReferences: string[];
  format?: ProductFormat;
  identityKey?: string;
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
    thumbnail?: { url: string };
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
  configuredStatus?: StoreConfiguredStatus;
  runtimeStatus?: StoreRuntimeStatus;
  sourceKind?: "public_html" | "public_structured_feed" | "authorized_feed" | "none";
  fastWatchCapable?: boolean;
  discoveryCapable?: boolean;
  commercialEligible?: boolean;
}

export interface ConnectorDefinition {
  key: StoreKey;
  name: string;
  sources: string[];
  productUrlPatterns: RegExp[];
  /**
   * Ramène les variantes de tracking d'une même fiche vers une URL stable.
   * Exemple : les multiples formes Amazon d'un même ASIN.
   */
  canonicalizeProductUrl?: (url: string) => string;
  maxConcurrency?: number;
  requestHeaders?: Record<string, string>;
  followDiscoveredProductPages?: boolean;
  maxDiscoveredProductPages?: number;
  /**
   * Certaines marketplaces ne doivent alerter que lorsque la fiche directe
   * confirme le vendeur attendu (Fnac, E.Leclerc, Carrefour, Amazon...).
   */
  requiresDirectProductPageForAlerts?: boolean;
  requiredSellerPatterns?: RegExp[];
  requiredSellerLabel?: string;
  /** Intègre/audite une source sans autoriser ses alertes commerciales. */
  commercialAlertsEnabled?: boolean;
  /** Un HTTP 200 seul ne suffit pas : un marqueur métier doit être présent. */
  responseMustContainAny?: RegExp[];
  /** Nom du secret Cloudflare contenant l'URL d'un flux produit autorisé. */
  authorizedFeedEnv?: string;
  /**
   * Pour les origines anti-bot connues, évite de les marteler chaque minute
   * lorsque le flux autorisé n'est pas encore configuré.
   */
  directPollingDisabledWithoutFeed?: boolean;
  /** Une source structurée publique peut faire foi sans relire chaque fiche HTML. */
  authoritativeStructuredFeed?: boolean;
  notes: string[];
}

export interface Env {
  AUDIT_MODE?: string;
  ALLOW_PUBLIC_AUDIT?: string;
  MONITORING_ENABLED?: string;
  ACTIVE_STORES?: string;
  WRITE_STATE?: string;
  DISCORD_MODE?: "dry-run" | "live";
  DISCORD_WEBHOOK_URL?: string;
  PREVIEW_AUDIT_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  BRAVE_SEARCH_API_KEY?: string;
  AUTHORIZED_FEED_PLAYIN_URL?: string;
  AUTHORIZED_FEED_CULTURA_URL?: string;
  AUTHORIZED_FEED_MICROMANIA_URL?: string;
  AUTHORIZED_FEED_FNAC_URL?: string;
  AUTHORIZED_FEED_CARREFOUR_URL?: string;
  AUTHORIZED_FEED_KING_JOUET_URL?: string;
  AUTHORIZED_FEED_JOUECLUB_URL?: string;
  AUTHORIZED_FEED_LA_GRANDE_RECRE_URL?: string;
  AUTHORIZED_FEED_BCD_JEUX_URL?: string;
  TCG_STATE?: KVNamespace;
}
