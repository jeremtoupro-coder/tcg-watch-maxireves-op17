import { getEnabledAlerts, WATCH_CONFIG } from "./config";
import type { AlertMatch, AlertRule, ProductChange, WatchConfig } from "./types";

function includesWildcard<T extends string>(values: Array<T | "*">, value: T): boolean {
  return values.includes("*") || values.includes(value);
}

function matchesRule(change: ProductChange, rule: AlertRule, config: WatchConfig): boolean {
  if (!rule.enabled) return false;
  if (!rule.events.includes(change.type)) return false;

  if (
    change.initial &&
    !rule.notifyOnInitialDiscovery &&
    !config.settings.notifyOnInitialDiscovery
  ) {
    return false;
  }

  const hasProduct = change.candidate.matchedReferences.some((reference) =>
    rule.productIds.includes(reference)
  );
  if (!hasProduct) return false;

  if (!includesWildcard(rule.stores, change.candidate.store)) return false;
  if (!includesWildcard(rule.languages, change.candidate.language)) return false;
  if (!includesWildcard(rule.availabilities, change.candidate.availability)) return false;

  if (
    rule.maxPriceCents !== undefined &&
    (change.current.priceCents === undefined || change.current.priceCents > rule.maxPriceCents)
  ) {
    return false;
  }

  return true;
}

export function evaluateAlertRules(
  changes: ProductChange[],
  config: WatchConfig = WATCH_CONFIG
): AlertMatch[] {
  const matches: AlertMatch[] = [];
  const seen = new Set<string>();

  for (const change of changes) {
    for (const rule of getEnabledAlerts()) {
      if (!matchesRule(change, rule, config)) continue;

      const dedupeKey = `${rule.id}:${change.current.key}:${change.type}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      matches.push({
        rule,
        change,
        matchedProductIds: change.candidate.matchedReferences.filter((reference) =>
          rule.productIds.includes(reference)
        )
      });
    }
  }

  return matches;
}
