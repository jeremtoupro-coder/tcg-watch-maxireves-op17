import { CONNECTORS } from "../src/connectors";

const baseUrl = process.env.PRODUCTION_URL?.replace(/\/$/, "");
const token = process.env.PREVIEW_AUDIT_TOKEN?.trim();
const phase = process.env.PRODUCTION_SMOKE_PHASE?.trim();
if (!baseUrl || !token) throw new Error("PRODUCTION_URL et PREVIEW_AUDIT_TOKEN sont obligatoires.");
if (phase !== "standby" && phase !== "armed" && phase !== "live") {
  throw new Error("PRODUCTION_SMOKE_PHASE doit valoir standby, armed ou live.");
}

async function jsonRequest(path: string, authenticated = false, method = "GET"): Promise<Record<string, any>> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}?probe=${Date.now()}-${attempt}`, {
        method,
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

const jsonGet = (path: string, authenticated = false) => jsonRequest(path, authenticated, "GET");
const jsonPost = (path: string, authenticated = false) => jsonRequest(path, authenticated, "POST");

const authHealth = await jsonGet("/cockpit/api/auth/health", true);
if (authHealth.ok !== true || authHealth.hashing !== "hmac-sha256-v1") {
  throw new Error(`Cockpit auth health invalide: ${JSON.stringify(authHealth)}`);
}

const protectedScout = await jsonGet("/protected-store-scout-health", true);
if (protectedScout.bindingPresent !== true || protectedScout.searchConfigured !== true) {
  throw new Error(`Protected Store Scout non prêt: ${JSON.stringify(protectedScout)}`);
}

if (phase === "standby") {
  const root = await jsonGet("/");
  if (root.runtime?.monitoringEnabled !== false || root.runtime?.stateWritesEnabled !== false) {
    throw new Error("Standby invalide : monitoring ou écriture activé.");
  }
  if (root.runtime?.discordMode !== "dry-run") {
    throw new Error("Standby invalide : Discord n'est pas dry-run.");
  }
  console.log(JSON.stringify({
    ok: true,
    phase,
    monitoring: false,
    stateWrites: false,
    discord: "dry-run",
    cron: false,
    cockpitAuth: "PASS",
    protectedScout: "READY",
    deadmanConfigured: protectedScout.deadmanConfigured === true
  }));
} else {
  const expectedStoreCount = CONNECTORS.length;
  const ready = await jsonGet("/runtime-ready", true);
  if (
    ready.status !== "ready" ||
    ready.mode !== "live" ||
    ready.schedulerMode !== "live" ||
    ready.discordMode !== "live" ||
    ready.monitoringEnabled !== true ||
    ready.stateWritesEnabled !== true ||
    !Array.isArray(ready.stores) ||
    ready.stores.length !== expectedStoreCount
  ) {
    throw new Error(`Readiness ${phase} invalide: ${JSON.stringify(ready)}`);
  }
  if (phase === "armed") {
    if (ready.automaticPolling !== false) throw new Error("La phase armed sans cron ne doit pas être observée comme active.");
    console.log(JSON.stringify({
      ok: true,
      phase,
      readiness: "PASS",
      schedulerObserved: false,
      stores: ready.stores.length,
      cockpitAuth: "PASS",
      protectedScout: "READY",
      deadmanConfigured: protectedScout.deadmanConfigured === true
    }));
  } else {
    const armed = await jsonPost("/scheduler-watchdog/arm", true);
    const baseline = Number(armed.health?.receivedCount) || 0;
    let observed: Record<string, any> | undefined;
    for (let attempt = 1; attempt <= 240; attempt += 1) {
      const current = await jsonGet("/scheduler-health", true);
      const received = Number(current.health?.receivedCount) || 0;
      const monitoring = current.health?.automaticMonitoring;
      if (
        current.observed?.observedRecently === true &&
        received >= baseline + 2 &&
        monitoring?.status === "completed" &&
        Date.parse(monitoring.completedAt || "") >= Date.parse(armed.health?.armedAt || "")
      ) {
        observed = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (!observed) {
      throw new Error("Le cron final n'a pas démontré deux Scheduled Events et un cycle automatique terminé en vingt minutes.");
    }
    console.log(JSON.stringify({
      ok: true,
      phase,
      readiness: "PASS",
      schedulerObserved: "PASS",
      automaticCyclesObserved: (Number(observed.health?.receivedCount) || 0) - baseline,
      lastAutomaticMonitoring: observed.health?.automaticMonitoring?.status,
      stores: ready.stores.length,
      cockpitAuth: "PASS",
      protectedScout: "READY",
      deadmanConfigured: protectedScout.deadmanConfigured === true
    }));
  }
}
