import type { AlertMatch, DiscordPayload, Env } from "./types";
import { detectProductFormat } from "./opwatchV1";

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

const FORMAT_LABELS = {
  booster: "Booster à l'unité",
  display: "Display / booster box",
  case: "Case / carton",
  double_pack: "Double pack",
  starter: "Starter deck",
  other: "Format non déterminé"
} as const;

const DISCORD_TIMEOUT_MS = 15_000;
const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com"]);

function validDiscordWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.port === "" &&
      !parsed.username &&
      !parsed.password &&
      DISCORD_WEBHOOK_HOSTS.has(parsed.hostname) &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(parsed.pathname) &&
      parsed.search === "" &&
      parsed.hash === "";
  } catch {
    return false;
  }
}

function previousPrice(match: AlertMatch): string | undefined {
  return match.change.previous?.priceText;
}

function sellerLabel(match: AlertMatch): string | undefined {
  const candidate = match.change.candidate;
  if (candidate.store === "leclerc") {
    return candidate.seller?.trim() || "Vendeur non confirmé (Marketplace E.Leclerc)";
  }
  return candidate.seller?.trim() || undefined;
}

export function buildDiscordPayload(match: AlertMatch): DiscordPayload {
  const candidate = match.change.candidate;
  const eventLabel = EVENT_LABELS[match.change.type];
  const price = candidate.priceText ?? "Prix non détecté";
  const oldPrice = previousPrice(match);
  const priceValue = oldPrice && oldPrice !== price ? `${oldPrice} → ${price}` : price;
  const format = candidate.format ?? detectProductFormat(`${candidate.title} ${candidate.url}`);
  const seller = sellerLabel(match);
  const detectedAt = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris"
  }).format(new Date(match.change.detectedAt));

  const embed: DiscordPayload["embeds"][number] = {
    title: `${eventLabel} — ${match.matchedProductIds.join(", ")}`,
    url: candidate.url,
    description: candidate.title,
    fields: [
      { name: "🏷️ Référence", value: match.matchedProductIds.join(", "), inline: true },
      { name: "🧩 Format", value: FORMAT_LABELS[format], inline: true },
      { name: "💰 Prix", value: priceValue, inline: true },
      { name: "🏪 Boutique", value: candidate.storeName, inline: true },
      ...(seller ? [{ name: "✅ Vendeur", value: seller, inline: true }] : []),
      { name: "📦 Disponibilité", value: AVAILABILITY_LABELS[candidate.availability], inline: true },
      { name: "🇫🇷 Langue", value: candidate.language, inline: true },
      { name: "🕒 Détecté", value: detectedAt, inline: true },
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

  if (!validDiscordWebhookUrl(env.DISCORD_WEBHOOK_URL)) {
    return {
      mode,
      attempted: payloads.length,
      sent: 0,
      errors: ["DISCORD_WEBHOOK_URL n'est pas un endpoint webhook Discord officiel valide."]
    };
  }

  let sent = 0;
  const errors: string[] = [];

  for (const payload of payloads) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
    try {
      const response = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        errors.push(`Discord HTTP ${response.status}`);
        continue;
      }

      sent += 1;
    } catch (error) {
      errors.push(
        error instanceof Error && error.name === "AbortError"
          ? "Discord: délai réseau dépassé"
          : error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    mode,
    attempted: payloads.length,
    sent,
    errors
  };
}
