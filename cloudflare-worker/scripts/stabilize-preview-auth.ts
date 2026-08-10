export {};

const baseUrl = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
const auditToken = process.env.PREVIEW_AUDIT_TOKEN ?? "";
const MAX_ATTEMPTS = 45;
const REQUIRED_CONSECUTIVE_SUCCESSES = 8;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 4_000;

if (!baseUrl) throw new Error("PREVIEW_URL est obligatoire.");
if (!auditToken) throw new Error("PREVIEW_AUDIT_TOKEN est obligatoire.");

let consecutiveSuccesses = 0;
let lastDiagnostic = "aucune réponse";

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL("/audit", baseUrl);
    url.searchParams.set("store", "playin");
    url.searchParams.set("probe", `${Date.now()}-${attempt}`);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${auditToken}`,
        "User-Agent": "OPWatchPreviewAuthStabilizer/1.0"
      }
    });
    const raw = await response.text();
    let body: { mode?: string; stores?: Array<{ store?: string }> } | undefined;
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      body = undefined;
    }

    const valid = response.status === 200 &&
      body?.mode === "READ_ONLY_AUDIT" &&
      body.stores?.[0]?.store === "playin";
    if (valid) {
      consecutiveSuccesses += 1;
      lastDiagnostic = `HTTP 200 valide (${consecutiveSuccesses}/${REQUIRED_CONSECUTIVE_SUCCESSES})`;
    } else {
      consecutiveSuccesses = 0;
      lastDiagnostic = `HTTP ${response.status}, réponse ${body ? "JSON incohérente" : "non-JSON"}`;
      if (![200, 401, 429].includes(response.status) && response.status < 500) {
        throw new Error(`La route Preview ne peut pas se stabiliser: ${lastDiagnostic}.`);
      }
    }
  } catch (error) {
    consecutiveSuccesses = 0;
    lastDiagnostic = error instanceof Error ? error.message : String(error);
    if (/ne peut pas se stabiliser/.test(lastDiagnostic)) throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (consecutiveSuccesses >= REQUIRED_CONSECUTIVE_SUCCESSES) {
    console.log(`Authentification Preview stable après ${attempt} sonde(s).`);
    process.exit(0);
  }
  if (attempt < MAX_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

throw new Error(
  `Authentification Preview instable après ${MAX_ATTEMPTS} sondes: ${lastDiagnostic}.`
);
