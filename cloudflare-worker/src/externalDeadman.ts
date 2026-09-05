const ALLOWED_DEADMAN_HOSTS = new Set([
  "hc-ping.com",
  "uptime.betterstack.com"
]);

export interface ExternalDeadmanEnv {
  EXTERNAL_DEADMAN_PING_URL?: string;
}

export function validatedDeadmanUrl(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return undefined;
    if (!ALLOWED_DEADMAN_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    if (url.pathname.length < 2 || url.pathname.length > 500) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function pingExternalDeadman(
  env: ExternalDeadmanEnv,
  scheduledTime: number
): Promise<"disabled" | "sent" | "failed"> {
  const url = validatedDeadmanUrl(env.EXTERNAL_DEADMAN_PING_URL);
  if (!url) return "disabled";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const target = new URL(url);
    target.searchParams.set("ts", String(scheduledTime));
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "OPWatch-Deadman/1.0 (+scheduler-liveness)" }
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      console.error(`External dead-man ping HTTP ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("External dead-man ping failed:", error instanceof Error ? error.message : String(error));
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}
