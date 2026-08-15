import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const productionUrl = (process.env.PRODUCTION_URL || "").replace(/\/$/, "");
const cloudflareToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const discordWebhook = (process.env.DISCORD_WEBHOOK_URL || "").trim();
const stateDirectory = process.env.WATCHDOG_STATE_DIRECTORY || ".watchdog-state";
const activatedPath = `${stateDirectory}/activated`;
const alertedPath = `${stateDirectory}/alerted`;
const staleMs = 3 * 60_000;

if (!productionUrl || cloudflareToken.length < 20 || !discordWebhook) {
  throw new Error("PRODUCTION_URL, CLOUDFLARE_API_TOKEN et DISCORD_WEBHOOK_URL sont obligatoires.");
}

function validDiscordWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "discord.com" || url.hostname === "discordapp.com") &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname) &&
      !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

if (!validDiscordWebhook(discordWebhook)) throw new Error("DISCORD_WEBHOOK_URL invalide.");

const auditToken = createHmac("sha256", cloudflareToken)
  .update("op-watch-safe-preview-audit-v1")
  .digest("hex");

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${productionUrl}/scheduler-health?external=${Date.now()}`, {
      headers: { authorization: `Bearer ${auditToken}` },
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function alertDiscord(reason, detail) {
  const response = await fetch(discordWebhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "OP Watch",
      embeds: [{
        title: "🚨 OP Watch — watchdog externe GitHub",
        url: "https://op-watch-tcg-fr.pages.dev/cockpit/",
        description: "Un contrôle exécuté hors de Cloudflare ne peut plus confirmer le scheduler OP Watch.",
        fields: [
          { name: "Incident", value: reason.slice(0, 900), inline: false },
          { name: "Détail", value: detail.slice(0, 900), inline: false },
          { name: "Action", value: "Contrôler Cloudflare Cron Triggers, Past Events et les limites du compte.", inline: false }
        ],
        footer: { text: "OP Watch • watchdog externe • maximum une alerte par heure" },
        timestamp: new Date().toISOString()
      }]
    })
  });
  if (!response.ok) throw new Error(`Discord watchdog HTTP ${response.status}`);
  await writeFile(alertedPath, new Date().toISOString(), "utf8");
}

await mkdir(stateDirectory, { recursive: true });
const previouslyActivated = await exists(activatedPath);
const alreadyAlerted = await exists(alertedPath);

let probe;
try {
  probe = await fetchHealth();
} catch (error) {
  if (previouslyActivated && !alreadyAlerted) {
    await alertDiscord("Worker Cloudflare injoignable", error instanceof Error ? error.message : String(error));
  }
  console.log(JSON.stringify({ status: previouslyActivated ? "unreachable" : "not-activated", alerted: previouslyActivated && !alreadyAlerted }));
  process.exit(0);
}

if (probe.status === 404 && !previouslyActivated) {
  console.log(JSON.stringify({ status: "not-deployed", alerted: false }));
  process.exit(0);
}

const armedAt = typeof probe.body?.health?.armedAt === "string" ? probe.body.health.armedAt : "";
if (probe.ok && armedAt) {
  await writeFile(activatedPath, armedAt, "utf8");
}

const activated = previouslyActivated || Boolean(armedAt);
if (!activated) {
  console.log(JSON.stringify({ status: "not-armed", httpStatus: probe.status, alerted: false }));
  process.exit(0);
}

if (!probe.ok) {
  if (!alreadyAlerted) await alertDiscord(`Sonde scheduler HTTP ${probe.status}`, String(probe.body?.error || "réponse non exploitable"));
  console.log(JSON.stringify({ status: "probe-error", httpStatus: probe.status, alerted: !alreadyAlerted }));
  process.exit(0);
}

if (probe.body?.observed?.observedRecently === true) {
  console.log(JSON.stringify({ status: "healthy", alerted: false, checkedAt: probe.body.checkedAt }));
  process.exit(0);
}

const reference = Date.parse(probe.body?.health?.lastScheduledEvent?.receivedAt || armedAt);
const ageMs = Number.isFinite(reference) ? Date.now() - reference : Number.POSITIVE_INFINITY;
if (ageMs >= staleMs && !alreadyAlerted) {
  await alertDiscord(
    "Aucun Scheduled Event Cloudflare récent",
    `Dernier signal: ${probe.body?.health?.lastScheduledEvent?.receivedAt || "jamais"}; âge: ${Math.round(ageMs / 60_000)} min.`
  );
}
console.log(JSON.stringify({ status: "stale", ageMs, alerted: ageMs >= staleMs && !alreadyAlerted }));
