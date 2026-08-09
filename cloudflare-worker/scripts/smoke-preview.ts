export {};

const baseUrl = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
const auditToken = process.env.PREVIEW_AUDIT_TOKEN ?? "";
const MAX_ATTEMPTS = 12;
const REQUEST_TIMEOUT_MS = 15_000;
if (!baseUrl) throw new Error("PREVIEW_URL est obligatoire.");
if (!auditToken) throw new Error("PREVIEW_AUDIT_TOKEN est obligatoire.");

async function getJson(
  path: string,
  expectedStatus = 200,
  headers: Record<string, string> = {}
): Promise<Record<string, any>> {
  const url = `${baseUrl}${path}`;
  let lastError: unknown;

  // Cloudflare peut mettre quelques secondes à propager une nouvelle version.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "OPWatchPreviewSmoke/1.0", ...headers }
      });
      const raw = await response.text();
      let body: Record<string, any>;
      try {
        body = JSON.parse(raw) as Record<string, any>;
      } catch {
        throw new Error(
          `${path}: réponse non-JSON HTTP ${response.status} ` +
          `(${response.headers.get("content-type") ?? "type inconnu"}): ${raw.slice(0, 160)}`
        );
      }
      if (response.status !== expectedStatus) {
        throw new Error(`${path}: HTTP ${response.status}, attendu ${expectedStatus}: ${JSON.stringify(body)}`);
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 5_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const root = await getJson("/");
if (root.deployment !== "SAFE_PREVIEW") {
  throw new Error(`Le Worker déployé n'est pas SAFE_PREVIEW: ${root.deployment}`);
}
if (root.runtime?.monitoringEnabled !== false || root.runtime?.automaticPolling !== false) {
  throw new Error("La preview ne doit exécuter aucune surveillance automatique.");
}
if (root.runtime?.stateWritesEnabled !== false || root.runtime?.discordMode !== "dry-run") {
  throw new Error("La preview autorise une écriture ou un envoi Discord : arrêt.");
}
if (root.runtime?.stateBindingPresent !== false || root.runtime?.cron !== false) {
  throw new Error("La preview ne doit avoir ni KV ni cron.");
}

const health = await getJson("/health");
if (health.status !== "ok" || health.mode !== "SAFE_PREVIEW") {
  throw new Error(`Healthcheck invalide: ${JSON.stringify(health)}`);
}
if (!Array.isArray(health.stores) || health.stores.length !== 21) {
  throw new Error(`Le healthcheck ne décrit pas les 21 boutiques: ${JSON.stringify(health.stores)}`);
}

const config = await getJson("/config");
if (config.opWatchV1?.officialCatalogUrl !== "https://fr.onepiece-cardgame.com/products/") {
  throw new Error("La source calendrier n'est pas la source officielle française attendue.");
}
if (config.opWatchV1?.language?.strict !== true || config.opWatchV1?.language?.target !== "fr") {
  throw new Error("La configuration commerciale n'est pas strictement française.");
}
if (!Array.isArray(config.stores) || config.stores.length !== 21) {
  throw new Error("La configuration déployée ne contient pas exactement 21 boutiques.");
}

const calendar = await getJson("/opwatch/v1/calendar");
if (calendar.mode !== "SAFE_CALENDAR_PREVIEW") {
  throw new Error(`Mode calendrier inattendu: ${calendar.mode}`);
}
if (!Number.isInteger(calendar.catalogProductsParsed) || calendar.catalogProductsParsed < 1) {
  throw new Error(`Aucun produit officiel daté reconnu: ${JSON.stringify(calendar)}`);
}
if (!Array.isArray(calendar.activeProducts)) {
  throw new Error("activeProducts doit être un tableau.");
}
if (calendar.source !== "https://fr.onepiece-cardgame.com/products/") {
  throw new Error(`Source calendrier inattendue: ${calendar.source}`);
}

for (const product of calendar.activeProducts) {
  if (!product.id || !product.releaseDate || product.watchWindow?.active !== true) {
    throw new Error(`Produit actif incohérent: ${JSON.stringify(product)}`);
  }
}

const unauthorizedAudit = await getJson("/audit?store=playin", 401);
if (!/jeton/i.test(String(unauthorizedAudit.error ?? ""))) {
  throw new Error("La route d'audit ne refuse pas explicitement l'accès sans jeton.");
}

const protectedAudit = await getJson("/audit?store=playin", 200, {
  Authorization: `Bearer ${auditToken}`
});
if (protectedAudit.mode !== "READ_ONLY_AUDIT" || protectedAudit.stores?.[0]?.store !== "playin") {
  throw new Error(`Audit protégé incohérent: ${JSON.stringify(protectedAudit)}`);
}
if (!["pending_authorized_feed", "active_fast_watch"].includes(protectedAudit.stores[0].configuredStatus)) {
  throw new Error(`Statut Playin inattendu: ${protectedAudit.stores[0].configuredStatus}`);
}

console.log(JSON.stringify({
  ok: true,
  deployment: root.deployment,
  stores: health.stores.length,
  calendarProductsParsed: calendar.catalogProductsParsed,
  activeProductIds: calendar.activeProducts.map((product: any) => product.id),
  protectedAudit: "PASS"
}, null, 2));
