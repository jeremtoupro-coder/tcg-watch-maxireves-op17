const baseUrl = process.env.PRODUCTION_URL?.replace(/\/$/, "");
const token = process.env.PREVIEW_AUDIT_TOKEN?.trim();
const phase = process.env.PRODUCTION_SMOKE_PHASE?.trim();
if (!baseUrl || !token) throw new Error("PRODUCTION_URL et PREVIEW_AUDIT_TOKEN sont obligatoires.");
if (phase !== "standby" && phase !== "armed" && phase !== "live") {
  throw new Error("PRODUCTION_SMOKE_PHASE doit valoir standby, armed ou live.");
}

async function jsonGet(path: string, authenticated = false): Promise<Record<string, any>> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}?probe=${Date.now()}-${attempt}`, {
        headers: authenticated ? { authorization: `Bearer ${token}` } : undefined
      });
      const raw = await response.text();
      let body: Record<string, any>;
      try {
        body = JSON.parse(raw) as Record<string, any>;
      } catch {
        throw new Error(`${path}: réponse non-JSON HTTP ${response.status}: ${raw.replace(/\s+/g, " ").slice(0, 300)}`);
      }
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${body.error ?? raw.slice(0, 300)}`);
      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError ?? new Error(`${path}: aucune réponse exploitable.`);
}

if (phase === "standby") {
  const root = await jsonGet("/");
  if (root.runtime?.monitoringEnabled !== false || root.runtime?.stateWritesEnabled !== false) {
    throw new Error("Standby invalide : monitoring ou écriture activé.");
  }
  if (root.runtime?.discordMode !== "dry-run") {
    throw new Error("Standby invalide : Discord n'est pas dry-run.");
  }
  console.log(JSON.stringify({ ok: true, phase, monitoring: false, stateWrites: false, discord: "dry-run", cron: false }));
} else {
  const ready = await jsonGet("/runtime-ready", true);
  if (
    ready.status !== "ready" ||
    ready.mode !== "live" ||
    ready.schedulerMode !== "live" ||
    ready.discordMode !== "live" ||
    ready.monitoringEnabled !== true ||
    ready.stateWritesEnabled !== true ||
    ready.automaticPolling !== false ||
    !Array.isArray(ready.stores) ||
    ready.stores.length !== 21
  ) {
    throw new Error(`Readiness ${phase} invalide: ${JSON.stringify(ready)}`);
  }
  console.log(JSON.stringify({ ok: true, phase, readiness: "PASS", stores: ready.stores.length }));
}
