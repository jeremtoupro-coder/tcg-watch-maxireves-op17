import rawConfig from "../config/alerts.json";
import type { AlertRule, ProductDefinition, WatchConfig } from "./types";

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Configuration invalide: ${field} doit être une chaîne non vide.`);
  }
}

function validateProduct(product: ProductDefinition, index: number): void {
  requireNonEmptyString(product.id, `products[${index}].id`);
  requireNonEmptyString(product.label, `products[${index}].label`);

  if (!Array.isArray(product.aliases) || product.aliases.length === 0) {
    throw new Error(`Configuration invalide: products[${index}].aliases doit contenir au moins une valeur.`);
  }

  for (const [aliasIndex, alias] of product.aliases.entries()) {
    requireNonEmptyString(alias, `products[${index}].aliases[${aliasIndex}]`);
  }
}

function validateAlert(rule: AlertRule, index: number, productIds: Set<string>): void {
  requireNonEmptyString(rule.id, `alerts[${index}].id`);
  requireNonEmptyString(rule.label, `alerts[${index}].label`);

  if (!Array.isArray(rule.productIds) || rule.productIds.length === 0) {
    throw new Error(`Configuration invalide: alerts[${index}].productIds est vide.`);
  }

  for (const productId of rule.productIds) {
    if (!productIds.has(productId)) {
      throw new Error(`Configuration invalide: l'alerte ${rule.id} référence le produit inconnu ${productId}.`);
    }
  }

  if (!Array.isArray(rule.stores) || rule.stores.length === 0) {
    throw new Error(`Configuration invalide: alerts[${index}].stores est vide.`);
  }

  if (!Array.isArray(rule.languages) || rule.languages.length === 0) {
    throw new Error(`Configuration invalide: alerts[${index}].languages est vide.`);
  }

  if (!Array.isArray(rule.events) || rule.events.length === 0) {
    throw new Error(`Configuration invalide: alerts[${index}].events est vide.`);
  }

  if (!Array.isArray(rule.availabilities) || rule.availabilities.length === 0) {
    throw new Error(`Configuration invalide: alerts[${index}].availabilities est vide.`);
  }

  if (rule.maxPriceCents !== undefined && (!Number.isInteger(rule.maxPriceCents) || rule.maxPriceCents < 0)) {
    throw new Error(`Configuration invalide: alerts[${index}].maxPriceCents doit être un entier positif.`);
  }
}

export function validateWatchConfig(config: WatchConfig): WatchConfig {
  if (!Number.isInteger(config.version) || config.version < 1) {
    throw new Error("Configuration invalide: version doit être un entier supérieur ou égal à 1.");
  }

  if (!Array.isArray(config.products) || config.products.length === 0) {
    throw new Error("Configuration invalide: aucun produit surveillé.");
  }

  if (!Array.isArray(config.alerts)) {
    throw new Error("Configuration invalide: alerts doit être un tableau.");
  }

  const productIds = new Set<string>();
  for (const [index, product] of config.products.entries()) {
    validateProduct(product, index);
    if (productIds.has(product.id)) {
      throw new Error(`Configuration invalide: identifiant produit dupliqué ${product.id}.`);
    }
    productIds.add(product.id);
  }

  const alertIds = new Set<string>();
  for (const [index, alert] of config.alerts.entries()) {
    validateAlert(alert, index, productIds);
    if (alertIds.has(alert.id)) {
      throw new Error(`Configuration invalide: identifiant d'alerte dupliqué ${alert.id}.`);
    }
    alertIds.add(alert.id);
  }

  return config;
}

export const WATCH_CONFIG: WatchConfig = validateWatchConfig(rawConfig as WatchConfig);

export function getEnabledProducts(): ProductDefinition[] {
  return WATCH_CONFIG.products.filter((product) => product.enabled);
}

export function getEnabledAlerts(): AlertRule[] {
  return WATCH_CONFIG.alerts.filter((alert) => alert.enabled);
}
