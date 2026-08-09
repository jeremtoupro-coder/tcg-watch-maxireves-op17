const baseUrl = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!baseUrl) throw new Error("PREVIEW_URL est obligatoire.");

async function getJson(path: string): Promise<Record<string, any>> {
  const url = `${baseUrl}${path}`;
  let lastError: unknown;

  // Cloudflare peut mettre quelques secondes à propager une nouvelle version.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "OPWatchPreviewSmoke/1.0" }
      });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return await response.json() as Record<string, any>;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5_000));
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

const health = await getJson("/health");
if (health.status !== "ok" || health.mode !== "SAFE_PREVIEW") {
  throw new Error(`Healthcheck invalide: ${JSON.stringify(health)}`);
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

for (const product of calendar.activeProducts) {
  if (!product.id || !product.releaseDate || product.watchWindow?.active !== true) {
    throw new Error(`Produit actif incohérent: ${JSON.stringify(product)}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  deployment: root.deployment,
  pilotStores: root.v1?.pilotStores,
  calendarProductsParsed: calendar.catalogProductsParsed,
  activeProductIds: calendar.activeProducts.map((product: any) => product.id)
}, null, 2));
