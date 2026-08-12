const ALLOWED_EMAIL = "jrm.touitou@gmail.com";
const LEGACY_PASSWORD_SHA256 = "1ed7f0d774b4b9b878c9579c32db88d6983dcbf6936f1e12995d3fffe33c0670";
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const RESET_TTL_MS = 20 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 8;
const RESET_MIN_INTERVAL_MS = 5 * 60_000;
const PBKDF2_ITERATIONS = 210_000;

export interface CockpitAuthEnv {
  RESEND_API_KEY?: string;
}

interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
  updatedAt: string;
}

interface SessionRecord {
  email: string;
  createdAt: string;
  expiresAt: string;
}

interface ResetRecord {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

interface FailureRecord {
  count: number;
  windowStart: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const decodedSalt = base64UrlToBytes(salt);
  const saltBuffer = new ArrayBuffer(decodedSalt.byteLength);
  new Uint8Array(saltBuffer).set(decodedSalt);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: saltBuffer,
    iterations,
    hash: "SHA-256"
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function passwordRecord(password: string): Promise<PasswordRecord> {
  const saltBytes = new Uint8Array(18);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64Url(saltBytes);
  return {
    salt,
    hash: await derivePasswordHash(password, salt, PBKDF2_ITERATIONS),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: new Date().toISOString()
  };
}

function validPasswordShape(password: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 200;
}

async function sendResetEmail(env: CockpitAuthEnv, token: string): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Service d’envoi d’e-mail non configuré.");
  const resetUrl = `https://op-watch-tcg-fr.pages.dev/cockpit/?reset=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `opwatch-reset-${await sha256(token)}`
    },
    body: JSON.stringify({
      from: "OP Watch <onboarding@resend.dev>",
      to: [ALLOWED_EMAIL],
      subject: "Réinitialiser le mot de passe OP Watch",
      text: `Une demande de réinitialisation du mot de passe OP Watch vient d’être effectuée.\n\nOuvre ce lien dans les 20 minutes :\n${resetUrl}\n\nSi tu n’es pas à l’origine de cette demande, ignore cet e-mail.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#122033"><h2>OP Watch</h2><p>Une demande de réinitialisation du mot de passe du cockpit vient d’être effectuée.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#ff8a2a;color:#111;text-decoration:none;font-weight:700">Choisir un nouveau mot de passe</a></p><p>Ce lien expire dans 20 minutes et ne peut être utilisé qu’une seule fois.</p><p style="color:#64748b;font-size:13px">Si tu n’es pas à l’origine de cette demande, ignore cet e-mail.</p></div>`
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Envoi e-mail impossible (HTTP ${response.status})${detail ? ` : ${detail.slice(0, 240)}` : ""}`);
  }
}

export class CockpitAuthDurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: CockpitAuthEnv) {}

  private async verifyPassword(password: string): Promise<boolean> {
    const current = await this.state.storage.get<PasswordRecord>("auth:password");
    if (!current) return constantTimeEqual(await sha256(password), LEGACY_PASSWORD_SHA256);
    const derived = await derivePasswordHash(password, current.salt, current.iterations);
    return constantTimeEqual(derived, current.hash);
  }

  private async clearSessions(): Promise<void> {
    const sessions = await this.state.storage.list({ prefix: "session:" });
    if (sessions.size) await this.state.storage.delete([...sessions.keys()]);
  }

  private async login(input: { email?: unknown; password?: unknown; ipKey?: unknown }): Promise<Response> {
    const email = normalizeEmail(input.email);
    const password = input.password;
    const ipKey = typeof input.ipKey === "string" && /^[a-f0-9]{64}$/.test(input.ipKey) ? input.ipKey : "unknown";
    const failureKey = `failure:${ipKey}`;
    const now = Date.now();
    const failure = await this.state.storage.get<FailureRecord>(failureKey);
    if (failure && now - failure.windowStart < LOGIN_WINDOW_MS && failure.count >= LOGIN_MAX_FAILURES) {
      return json({ error: "Trop de tentatives. Réessaie dans quelques minutes." }, 429);
    }
    if (email !== ALLOWED_EMAIL || !validPasswordShape(password) || !await this.verifyPassword(password)) {
      const next: FailureRecord = failure && now - failure.windowStart < LOGIN_WINDOW_MS
        ? { count: failure.count + 1, windowStart: failure.windowStart }
        : { count: 1, windowStart: now };
      await this.state.storage.put(failureKey, next);
      return json({ error: "Adresse e-mail ou mot de passe incorrect." }, 401);
    }
    await this.state.storage.delete(failureKey);
    const token = randomToken();
    const tokenHash = await sha256(token);
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    const session: SessionRecord = { email: ALLOWED_EMAIL, createdAt: new Date(now).toISOString(), expiresAt };
    await this.state.storage.put(`session:${tokenHash}`, session);
    return json({ ok: true, token, email: ALLOWED_EMAIL, expiresAt });
  }

  private async session(input: { token?: unknown }): Promise<Response> {
    const token = typeof input.token === "string" ? input.token : "";
    if (!token) return json({ authenticated: false }, 401);
    const tokenHash = await sha256(token);
    const session = await this.state.storage.get<SessionRecord>(`session:${tokenHash}`);
    if (!session) return json({ authenticated: false }, 401);
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.state.storage.delete(`session:${tokenHash}`);
      return json({ authenticated: false }, 401);
    }
    return json({ authenticated: true, email: session.email, expiresAt: session.expiresAt });
  }

  private async logout(input: { token?: unknown }): Promise<Response> {
    const token = typeof input.token === "string" ? input.token : "";
    if (token) await this.state.storage.delete(`session:${await sha256(token)}`);
    return json({ ok: true });
  }

  private async forgot(input: { email?: unknown }): Promise<Response> {
    const email = normalizeEmail(input.email);
    if (email !== ALLOWED_EMAIL) return json({ ok: true });
    const now = Date.now();
    const lastSent = await this.state.storage.get<number>("reset:last-sent-at");
    if (lastSent && now - lastSent < RESET_MIN_INTERVAL_MS) {
      return json({ ok: true, throttled: true });
    }
    const token = randomToken();
    const reset: ResetRecord = {
      tokenHash: await sha256(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RESET_TTL_MS).toISOString()
    };
    await sendResetEmail(this.env, token);
    await this.state.storage.put("reset:active", reset);
    await this.state.storage.put("reset:last-sent-at", now);
    return json({ ok: true });
  }

  private async reset(input: { token?: unknown; password?: unknown }): Promise<Response> {
    const token = typeof input.token === "string" ? input.token : "";
    const password = input.password;
    if (!token || !validPasswordShape(password)) {
      return json({ error: "Lien invalide ou mot de passe trop court (12 caractères minimum)." }, 400);
    }
    const active = await this.state.storage.get<ResetRecord>("reset:active");
    if (!active || Date.parse(active.expiresAt) <= Date.now() || !constantTimeEqual(active.tokenHash, await sha256(token))) {
      return json({ error: "Ce lien de réinitialisation est invalide ou expiré." }, 400);
    }
    await this.state.storage.put("auth:password", await passwordRecord(password));
    await this.state.storage.delete("reset:active");
    await this.clearSessions();
    return json({ ok: true });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
    const pathname = new URL(request.url).pathname;
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (pathname === "/login") return this.login(input);
    if (pathname === "/session") return this.session(input);
    if (pathname === "/logout") return this.logout(input);
    if (pathname === "/forgot") return this.forgot(input);
    if (pathname === "/reset") return this.reset(input);
    return json({ error: "Route auth inconnue." }, 404);
  }
}

export const COCKPIT_ALLOWED_EMAIL = ALLOWED_EMAIL;
