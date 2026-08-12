import runtimeWorker, {
  CalendarCoordinatorDurableObject,
  StoreMonitorDurableObject,
  WebScoutDurableObject
} from "./runtimeEntry";
import { CockpitAuthDurableObject } from "./cockpitAuth";
import { handleCockpitWebScout } from "./cockpitWebScout";
import type { RuntimeEnv } from "./durableMonitoring";
import type { Env } from "./types";

export { CalendarCoordinatorDurableObject, StoreMonitorDurableObject, WebScoutDurableObject, CockpitAuthDurableObject };

type RuntimeWithScoutEnv = RuntimeEnv & {
  WEB_SCOUT?: DurableObjectNamespace;
  COCKPIT_AUTH?: DurableObjectNamespace;
  RESEND_API_KEY?: string;
};

const SESSION_COOKIE = "opwatch_cockpit_session";
const ALLOWED_ORIGIN = "https://op-watch-tcg-fr.pages.dev";

function authStub(env: RuntimeWithScoutEnv): DurableObjectStub {
  if (!env.COCKPIT_AUTH) throw new Error("COCKPIT_AUTH absent.");
  return env.COCKPIT_AUTH.get(env.COCKPIT_AUTH.idFromName("production:cockpit-auth"));
}

function cookieValue(request: Request, name: string): string {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/cockpit; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function authHeaders(request: Request): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  const origin = request.headers.get("origin");
  if (!origin || origin === ALLOWED_ORIGIN) {
    headers.set("access-control-allow-origin", ALLOWED_ORIGIN);
    headers.set("vary", "Origin");
  }
  return headers;
}

function authJson(request: Request, data: unknown, status = 200, cookie?: string): Response {
  const headers = authHeaders(request);
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authDo(env: RuntimeWithScoutEnv, pathname: string, input: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await authStub(env).fetch(new Request(`https://cockpit-auth.internal${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
  const data = await response.json().catch(() => ({ error: "Réponse auth invalide." })) as Record<string, unknown>;
  return { status: response.status, data };
}

async function handleAuthApi(request: Request, env: RuntimeWithScoutEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "OPTIONS") {
    const headers = authHeaders(request);
    headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    return new Response(null, { status: 204, headers });
  }
  if (!env.COCKPIT_AUTH) return authJson(request, { error: "Authentification cockpit non déployée." }, 503);

  if (pathname === "/cockpit/api/auth/session" && request.method === "GET") {
    const result = await authDo(env, "/session", { token: cookieValue(request, SESSION_COOKIE) });
    return authJson(request, result.data, result.status);
  }
  if (pathname === "/cockpit/api/auth/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const result = await authDo(env, "/login", { ...body, ipKey: await sha256(ip) });
    const token = typeof result.data.token === "string" ? result.data.token : "";
    const exposed = { ...result.data };
    delete exposed.token;
    return authJson(request, exposed, result.status, token ? sessionCookie(token, 7 * 24 * 60 * 60) : undefined);
  }
  if (pathname === "/cockpit/api/auth/logout" && request.method === "POST") {
    const result = await authDo(env, "/logout", { token: cookieValue(request, SESSION_COOKIE) });
    return authJson(request, result.data, result.status, sessionCookie("", 0));
  }
  if (pathname === "/cockpit/api/auth/forgot-password" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await authDo(env, "/forgot", body);
    const exposed = result.status >= 400 ? result.data : { ok: true };
    return authJson(request, exposed, result.status);
  }
  if (pathname === "/cockpit/api/auth/reset-password" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await authDo(env, "/reset", body);
    return authJson(request, result.data, result.status, result.status < 300 ? sessionCookie("", 0) : undefined);
  }
  return authJson(request, { error: "Route d’authentification inconnue." }, 404);
}

async function withCockpitSession(request: Request, env: RuntimeWithScoutEnv): Promise<Request | Response> {
  if (!env.COCKPIT_AUTH) return request;
  const token = cookieValue(request, SESSION_COOKIE);
  const result = await authDo(env, "/session", { token });
  if (result.status !== 200 || result.data.authenticated !== true) {
    return authJson(request, { error: "Session cockpit expirée ou absente." }, 401, sessionCookie("", 0));
  }
  const readinessToken = env.PREVIEW_AUDIT_TOKEN?.trim();
  if (!readinessToken) return authJson(request, { error: "Jeton interne cockpit indisponible." }, 503);
  const headers = new Headers(request.headers);
  headers.delete("x-op-watch-admin-password");
  headers.set("authorization", `Bearer ${readinessToken}`);
  return new Request(request, { headers });
}

export default {
  async fetch(request: Request, baseEnv: Env): Promise<Response> {
    const env = baseEnv as RuntimeWithScoutEnv;
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/cockpit/api/auth/")) {
      return handleAuthApi(request, env);
    }

    if (pathname.startsWith("/cockpit/api/")) {
      const authorizedRequest = await withCockpitSession(request, env);
      if (authorizedRequest instanceof Response) return authorizedRequest;
      if (pathname === "/cockpit/api/web-scout") {
        return handleCockpitWebScout(authorizedRequest, env);
      }
      return runtimeWorker.fetch(authorizedRequest, env);
    }

    return runtimeWorker.fetch(request, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    runtimeWorker.scheduled(controller, env, ctx);
  }
};
