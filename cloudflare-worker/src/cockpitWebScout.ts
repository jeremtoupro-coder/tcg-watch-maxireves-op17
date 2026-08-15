import type { RuntimeEnv } from "./durableMonitoring";
import { readSchedulerHealth } from "./schedulerHealth";
import type { WebScoutHealth } from "./webScout";

const ALLOWED_ORIGIN = "https://op-watch-tcg-fr.pages.dev";
const WEB_SCOUT_MINUTE = 7;

type CockpitWebScoutEnv = RuntimeEnv & { WEB_SCOUT?: DurableObjectNamespace };

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}

function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(request)
    }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function authorized(request: Request, env: RuntimeEnv): Promise<boolean> {
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim() ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return Boolean(expected && bearer) && constantTimeEqual(bearer, expected);
}

function nextScheduledAt(now: number): string {
  const date = new Date(now);
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(WEB_SCOUT_MINUTE);
  if (next.getTime() <= date.getTime()) next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

async function readHealth(env: CockpitWebScoutEnv): Promise<WebScoutHealth | null> {
  if (!env.WEB_SCOUT) return null;
  const stub = env.WEB_SCOUT.get(env.WEB_SCOUT.idFromName("production:web-scout"));
  const response = await stub.fetch(new Request("https://web-scout.internal/health", { method: "GET" }));
  if (!response.ok) throw new Error(`Web Scout health HTTP ${response.status}`);
  const data = await response.json() as { health?: WebScoutHealth };
  return data.health ?? null;
}

export async function handleCockpitWebScout(request: Request, env: CockpitWebScoutEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const origin = request.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) return json(request, { error: "Origine refusée." }, 403);
  if (!await authorized(request, env)) return json(request, { error: "Accès cockpit invalide." }, 401);
  if (request.method !== "GET") return json(request, { error: "Méthode non autorisée. GET uniquement." }, 405);

  const now = Date.now();
  const bindingPresent = Boolean(env.WEB_SCOUT);
  const searchConfigured = Boolean(env.BRAVE_SEARCH_API_KEY?.trim());
  let health: WebScoutHealth | null = null;
  let healthError: string | undefined;
  const scheduler = await readSchedulerHealth(env).catch((error) => ({
    health: null,
    observed: { status: "never_seen" as const, observedRecently: false, staleAfterMs: 3 * 60_000 },
    error: error instanceof Error ? error.message : String(error)
  }));

  if (bindingPresent) {
    try {
      health = await readHealth(env);
    } catch (error) {
      healthError = error instanceof Error ? error.message : String(error);
    }
  }

  return json(request, {
    checkedAt: new Date(now).toISOString(),
    ready: bindingPresent && searchConfigured && scheduler.observed.observedRecently && env.RUNTIME_TEST_MODE !== "true",
    bindingPresent,
    searchConfigured,
    schedulerConfigured: env.CRON_CONFIGURED === "true",
    schedulerObserved: scheduler.observed,
    cadence: {
      kind: "hourly",
      minute: WEB_SCOUT_MINUTE,
      label: "Toutes les heures à :07",
      nextScheduledAt: health?.nextExpectedRunAt ?? nextScheduledAt(now),
      overdue: health?.checkedAt ? now - Date.parse(health.checkedAt) > 65 * 60_000 : true
    },
    health,
    ...(healthError ? { healthError } : {})
  });
}
