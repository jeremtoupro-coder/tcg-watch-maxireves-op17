import type { AlertMatch, DiscordPayload, Env } from "./types";

const EVENT_LABELS: Record<AlertMatch["change"]["type"], string> = {
  new_listing: "Nouvelle fiche détectée",
  back_in_stock: "Retour en stock",
  preorder_opened: "Précommande ouverte",
  price_drop: "Baisse de prix",
  price_increase: "Hausse de prix",
  became_unavailable: "Produit indisponible",
  details_changed: "Fiche modifiée"
};

const AVAILABILITY_LABELS: Record<AlertMatch["change"]["candidate"]["availability"], string> = {
  available: "En stock",
  preorder: "Précommande",
  unavailable: "Indisponible",
  unknown: "Statut inconnu"
};

function previousPrice(match: AlertMatch): string | undefined {
  return match.change.previous?.priceText;
}

export function buildDiscordPayload(match: AlertMatch): DiscordPayload {
  const candidate = match.change.candidate;
  const eventLabel = EVENT_LABELS[match.change.type];
  const price = candidate.priceText ?? "Prix non détecté";
  const oldPrice = previousPrice(match);
  const priceValue = oldPrice && oldPrice !== price ? `${oldPrice} → ${price}` : price;

  const embed: DiscordPayload["embeds"][number] = {
    title: `${eventLabel} — ${match.matchedProductIds.join(", ")}`,
    url: candidate.url,
    description: candidate.title,
    fields: [
      { name: "💰 Prix", value: priceValue, inline: true },
      { name: "🏪 Vendeur", value: candidate.storeName, inline: true },
      { name: "📦 Disponibilité", value: AVAILABILITY_LABELS[candidate.availability], inline: true },
      { name: "🇫🇷 Langue", value: candidate.language, inline: true },
      { name: "🔗 Offre", value: `[Voir le produit](${candidate.url})`, inline: false }
    ],
    footer: { text: `OP Watch • ${match.rule.id}` },
    timestamp: match.change.detectedAt
  };

  if (candidate.imageUrl) embed.thumbnail = { url: candidate.imageUrl };

  return {
    username: "OP Watch",
    embeds: [embed]
  };
}

export function buildDiscordPayloads(matches: AlertMatch[]): DiscordPayload[] {
  return matches.map(buildDiscordPayload);
}

export async function dispatchDiscordPayloads(
  payloads: DiscordPayload[],
  env: Env
): Promise<{
  mode: "dry-run" | "live";
  attempted: number;
  sent: number;
  errors: string[];
}> {
  const mode = env.DISCORD_MODE ?? "dry-run";

  if (mode === "dry-run") {
    return {
      mode,
      attempted: payloads.length,
      sent: 0,
      errors: []
    };
  }

  if (!env.DISCORD_WEBHOOK_URL) {
    return {
      mode,
      attempted: payloads.length,
      sent: 0,
      errors: ["DISCORD_WEBHOOK_URL est absent : aucun message n'a été envoyé."]
    };
  }

  let sent = 0;
  const errors: string[] = [];

  for (const payload of payloads) {
    try {
      const response = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        errors.push(`Discord HTTP ${response.status}`);
        continue;
      }

      sent += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    mode,
    attempted: payloads.length,
    sent,
    errors
  };
}
