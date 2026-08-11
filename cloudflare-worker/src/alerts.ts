import type { AlertMatch, AlertRule, ProductChange, WatchConfig } from "./types";

function includesWildcard<T extends string>(values: Array<T | "*">, value: T): boolean {
  return values.includes("*") || values.includes(value);
}

function matchesRule(change: ProductChange, rule: AlertRule, config: WatchConfig): boolean {
  if (!rule.enabled) return false;
  if (!rule.events.includes(change.type)) return false;

  // Une carte de catégorie peut alimenter l'état (notamment pour ONE PIECE ALL)
  // mais ne doit jamais déclencher Discord tant que la fiche directe / source
  // structurée n'a pas satisfait les garde-fous commerciaux du connecteur.
  if (change.candidate.commercialEligible === false) return false;

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
  config: WatchConfig
): AlertMatch[] {
  const matches: AlertMatch[] = [];
  const seen = new Set<string>();
  const enabledRules = config.alerts.filter((rule) => rule.enabled);

  for (const change of changes) {
    for (const rule of enabledRules) {
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

  // Un même relevé peut produire simultanément, par exemple, un retour en
  // stock et une baisse de prix. Le message de disponibilité contient déjà
  // le nouveau prix : une seule notification par produit et par cycle évite
  // le doublon commercial sans perdre l'information utile.
  const eventPriority: Record<ProductChange["type"], number> = {
    new_listing: 0,
    preorder_opened: 1,
    back_in_stock: 2,
    became_unavailable: 3,
    price_drop: 4,
    price_increase: 5,
    details_changed: 6
  };
  const byProduct = new Map<string, AlertMatch>();
  for (const match of matches) {
    const key = match.change.current.key;
    const existing = byProduct.get(key);
    if (!existing || eventPriority[match.change.type] < eventPriority[existing.change.type]) {
      byProduct.set(key, match);
    }
  }
  return [...byProduct.values()];
}
