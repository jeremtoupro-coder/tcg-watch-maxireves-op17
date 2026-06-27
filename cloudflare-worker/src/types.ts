export type StoreKey = "maxireves" | "ludotrotter" | "oupi" | "fantasy-sphere";

export type Availability = "available" | "preorder" | "unavailable" | "unknown";

export type LanguageStatus =
  | "Français confirmé"
  | "Langue non précisée"
  | "Anglais détecté"
  | "Japonais détecté"
  | "Autre langue détectée";

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
}
