import { dispatchDiscordPayloads } from "./discord";
import type { DiscordPayload, Env } from "./types";

export const SCHEDULER_STALE_MS = 3 * 60_000;
export const SCHEDULER_WATCHDOG_REPEAT_MS = 60 * 60_000;
const SCHEDULER_HEALTH_KEY = "scheduler:health:v1";
const SCHEDULER_EVENT_HISTORY_LIMIT = 12;

export type SchedulerMarkerKind =
  | "scheduled_received"
  | "monitoring_started"
  | "monitoring_completed"
  | "monitoring_failed"
  | "web_scout_started"
  | "web_scout_completed"
  | "web_scout_failed"
  | "automatic_heartbeat_started"
  | "automatic_heartbeat_completed"
  | "automatic_heartbeat_failed"
  | "manual_heartbeat_started"
  | "manual_heartbeat_completed"
  | "manual_heartbeat_failed"
  | "fallback_monitoring_started"
  | "fallback_monitoring_completed"
  | "fallback_monitoring_failed"
  | "fallback_web_scout_started"
  | "fallback_web_scout_completed"
  | "fallback_web_scout_failed";

export interface SchedulerMarker {
  kind: SchedulerMarkerKind;
  scheduledTime: number;
  observedTime?: number;
  discovery?: boolean;
  durationMs?: number;
  completedStores?: number;
  incidentStores?: number;
  error?: string;
}

export interface SchedulerRunObservation {
  status: "running" | "completed" | "error";
  scheduledAt: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  completedStores?: number;
  incidentStores?: number;
  error?: string;
}

export interface SchedulerHealth {
  version: 1;
  armedAt?: string;
  receivedCount: number;
  recentScheduledEvents: Array<{ scheduledAt: string; receivedAt: string }>;
  lastScheduledEvent?: { scheduledAt: string; receivedAt: string };
  automaticMonitoring?: SchedulerRunObservation;
  lastFastWatch?: SchedulerRunObservation;
  lastDiscovery?: SchedulerRunObservation;
  lastWebScout?: SchedulerRunObservation;
  lastAutomaticHeartbeat?: SchedulerRunObservation;
  lastManualHeartbeat?: SchedulerRunObservation;
  lastFallbackMonitoring?: SchedulerRunObservation;
  lastFallbackWebScout?: SchedulerRunObservation;
  consecutiveMonitoringFailures: number;
  watchdog: {
    status: "unarmed" | "armed" | "healthy" | "stale" | "disabled";
    nextCheckAt?: string;
    lastCheckedAt?: string;
    lastAlertAt?: string;
    lastAlertDelivered?: boolean;
    lastAlertError?: string;
    lastRecoveredAt?: string;
  };
}

export interface SchedulerObservedState {
  status: "disabled" | "never_seen" | "recent" | "stale";
  observedRecently: boolean;
  ageMs?: number;
  staleAfterMs: number;
}

interface SchedulerHealthEnv extends Env {
  CALENDAR_COORDINATOR?: DurableObjectNamespace;
  SCHEDULER_MODE?: "disabled" | "live";
  CRON_CONFIGURED?: string;
}

function initialHealth(): SchedulerHealth {
  return {
    version: 1,
    receivedCount: 0,
    recentScheduledEvents: [],
    consecutiveMonitoringFailures: 0,
    watchdog: { status: "unarmed" }
  };
}

function safeTime(value: number | undefined, fallback = Date.now()): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function safeError(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim().slice(0, 900);
  return cleaned || undefined;
}

function runningObservation(marker: SchedulerMarker, observedAt: string): SchedulerRunObservation {
  return {
    status: "running",
    scheduledAt: new Date(safeTime(marker.scheduledTime)).toISOString(),
    startedAt: observedAt
  };
}

function completedObservation(
  previous: SchedulerRunObservation | undefined,
  marker: SchedulerMarker,
  observedAt: string,
  status: "completed" | "error"
): SchedulerRunObservation {
  const scheduledAt = new Date(safeTime(marker.scheduledTime)).toISOString();
  const base = previous?.scheduledAt === scheduledAt
    ? previous
    : runningObservation(marker, observedAt);
  return {
    ...base,
    status,
    completedAt: observedAt,
    ...(marker.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(marker.durationMs)) } : {}),
    ...(marker.completedStores !== undefined ? { completedStores: Math.max(0, marker.completedStores) } : {}),
    ...(marker.incidentStores !== undefined ? { incidentStores: Math.max(0, marker.incidentStores) } : {}),
    ...(safeError(marker.error) ? { error: safeError(marker.error) } : {})
  };
}

export function applySchedulerMarker(
  current: SchedulerHealth | undefined,
  marker: SchedulerMarker
): SchedulerHealth {
  const next = structuredClone(current ?? initialHealth());
  const observedMs = safeTime(marker.observedTime);
  const observedAt = new Date(observedMs).toISOString();
  const scheduledAt = new Date(safeTime(marker.scheduledTime, observedMs)).toISOString();

  switch (marker.kind) {
    case "scheduled_received": {
      const previousReceived = next.lastScheduledEvent ? Date.parse(next.lastScheduledEvent.receivedAt) : Number.NaN;
      const recovering = Number.isFinite(previousReceived) && observedMs - previousReceived > SCHEDULER_STALE_MS;
      next.lastScheduledEvent = { scheduledAt, receivedAt: observedAt };
      next.receivedCount += 1;
      next.recentScheduledEvents = [
        ...next.recentScheduledEvents,
        { scheduledAt, receivedAt: observedAt }
      ].slice(-SCHEDULER_EVENT_HISTORY_LIMIT);
      next.watchdog.status = "healthy";
      next.watchdog.nextCheckAt = new Date(observedMs + SCHEDULER_STALE_MS).toISOString();
      if (recovering) next.watchdog.lastRecoveredAt = observedAt;
      break;
    }
    case "monitoring_started": {
      next.automaticMonitoring = runningObservation(marker, observedAt);
      if (marker.discovery) next.lastDiscovery = runningObservation(marker, observedAt);
      else next.lastFastWatch = runningObservation(marker, observedAt);
      break;
    }
    case "monitoring_completed": {
      const completed = completedObservation(next.automaticMonitoring, marker, observedAt, "completed");
      next.automaticMonitoring = completed;
      next.lastFastWatch = completed;
      if (marker.discovery) next.lastDiscovery = completed;
      next.consecutiveMonitoringFailures = 0;
      break;
    }
    case "monitoring_failed": {
      const failed = completedObservation(next.automaticMonitoring, marker, observedAt, "error");
      next.automaticMonitoring = failed;
      next.lastFastWatch = failed;
      if (marker.discovery) next.lastDiscovery = failed;
      next.consecutiveMonitoringFailures += 1;
      break;
    }
    case "web_scout_started":
      next.lastWebScout = runningObservation(marker, observedAt);
      break;
    case "web_scout_completed":
      next.lastWebScout = completedObservation(next.lastWebScout, marker, observedAt, "completed");
      break;
    case "web_scout_failed":
      next.lastWebScout = completedObservation(next.lastWebScout, marker, observedAt, "error");
      break;
    case "automatic_heartbeat_started":
      next.lastAutomaticHeartbeat = runningObservation(marker, observedAt);
      break;
    case "automatic_heartbeat_completed":
      next.lastAutomaticHeartbeat = completedObservation(next.lastAutomaticHeartbeat, marker, observedAt, "completed");
      break;
    case "automatic_heartbeat_failed":
      next.lastAutomaticHeartbeat = completedObservation(next.lastAutomaticHeartbeat, marker, observedAt, "error");
      break;
    case "manual_heartbeat_started":
      next.lastManualHeartbeat = runningObservation(marker, observedAt);
      break;
    case "manual_heartbeat_completed":
      next.lastManualHeartbeat = completedObservation(next.lastManualHeartbeat, marker, observedAt, "completed");
      break;
    case "manual_heartbeat_failed":
      next.lastManualHeartbeat = completedObservation(next.lastManualHeartbeat, marker, observedAt, "error");
      break;
    case "fallback_monitoring_started":
      next.lastFallbackMonitoring = runningObservation(marker, observedAt);
      break;
    case "fallback_monitoring_completed":
      next.lastFallbackMonitoring = completedObservation(next.lastFallbackMonitoring, marker, observedAt, "completed");
      break;
    case "fallback_monitoring_failed":
      next.lastFallbackMonitoring = completedObservation(next.lastFallbackMonitoring, marker, observedAt, "error");
      break;
    case "fallback_web_scout_started":
      next.lastFallbackWebScout = runningObservation(marker, observedAt);
      break;
    case "fallback_web_scout_completed":
      next.lastFallbackWebScout = completedObservation(next.lastFallbackWebScout, marker, observedAt, "completed");
      break;
    case "fallback_web_scout_failed":
      next.lastFallbackWebScout = completedObservation(next.lastFallbackWebScout, marker, observedAt, "error");
      break;
  }
  return next;
}

export function observedSchedulerState(
  health: SchedulerHealth | undefined,
  configured: boolean,
  now = Date.now()
): SchedulerObservedState {
  if (!configured) return { status: "disabled", observedRecently: false, staleAfterMs: SCHEDULER_STALE_MS };
  if (!health?.lastScheduledEvent) {
    return { status: "never_seen", observedRecently: false, staleAfterMs: SCHEDULER_STALE_MS };
  }
  const last = Date.parse(health.lastScheduledEvent.receivedAt);
  if (!Number.isFinite(last)) return { status: "never_seen", observedRecently: false, staleAfterMs: SCHEDULER_STALE_MS };
  const ageMs = Math.max(0, now - last);
  return {
    status: ageMs <= SCHEDULER_STALE_MS ? "recent" : "stale",
    observedRecently: ageMs <= SCHEDULER_STALE_MS,
    ageMs,
    staleAfterMs: SCHEDULER_STALE_MS
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function schedulerStub(env: SchedulerHealthEnv): DurableObjectStub {
  if (!env.CALENDAR_COORDINATOR) throw new Error("CALENDAR_COORDINATOR absent pour la santé scheduler.");
  return env.CALENDAR_COORDINATOR.get(env.CALENDAR_COORDINATOR.idFromName("production:scheduler-health"));
}

export async function markSchedulerHealth(env: SchedulerHealthEnv, marker: SchedulerMarker): Promise<void> {
  const response = await schedulerStub(env).fetch(new Request("https://scheduler-health.internal/mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(marker)
  }));
  if (!response.ok) throw new Error(`Scheduler health mark HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

export async function readSchedulerHealth(env: SchedulerHealthEnv): Promise<{
  health: SchedulerHealth | null;
  observed: SchedulerObservedState;
}> {
  const response = await schedulerStub(env).fetch(new Request("https://scheduler-health.internal/health"));
  if (!response.ok) throw new Error(`Scheduler health HTTP ${response.status}`);
  const data = await response.json() as { health?: SchedulerHealth | null };
  const health = data.health ?? null;
  return {
    health,
    observed: observedSchedulerState(health ?? undefined, env.CRON_CONFIGURED === "true")
  };
}

export async function armSchedulerWatchdog(env: SchedulerHealthEnv): Promise<SchedulerHealth> {
  const response = await schedulerStub(env).fetch(new Request("https://scheduler-health.internal/arm", { method: "POST" }));
  const data = await response.json() as { health?: SchedulerHealth; error?: string };
  if (!response.ok || !data.health) throw new Error(data.error ?? `Scheduler watchdog arm HTTP ${response.status}`);
  return data.health;
}

function watchdogPayload(health: SchedulerHealth, now: number): DiscordPayload {
  const last = health.lastScheduledEvent?.receivedAt ?? "jamais";
  return {
    username: "OP Watch",
    embeds: [{
      title: "🚨 OP Watch — scheduler automatique silencieux",
      url: "https://op-watch-tcg-fr.pages.dev/cockpit/",
      description: "Le watchdog Durable Object n’a observé aucun Scheduled Event récent. Monitoring marchand, Fast Watch, Discovery et Web Scout peuvent être arrêtés.",
      fields: [
        { name: "Dernier Scheduled Event reçu", value: last, inline: false },
        { name: "Seuil", value: `${Math.round(SCHEDULER_STALE_MS / 60_000)} minutes`, inline: true },
        { name: "Action", value: "Ouvrir le cockpit et contrôler Cloudflare Past Events.", inline: false }
      ],
      footer: { text: "OP Watch • watchdog indépendant du cron marchand" },
      timestamp: new Date(now).toISOString()
    }]
  };
}

export async function handleSchedulerHealthRequest(
  request: Request,
  storage: DurableObjectStorage,
  env: SchedulerHealthEnv
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/health") {
    const health = await storage.get<SchedulerHealth>(SCHEDULER_HEALTH_KEY);
    return json({
      health: health ?? null,
      observed: observedSchedulerState(health, env.CRON_CONFIGURED === "true")
    });
  }
  if (request.method === "POST" && pathname === "/arm") {
    const now = Date.now();
    const health = (await storage.get<SchedulerHealth>(SCHEDULER_HEALTH_KEY)) ?? initialHealth();
    health.armedAt = new Date(now).toISOString();
    health.watchdog.status = env.CRON_CONFIGURED === "true" ? "armed" : "disabled";
    health.watchdog.nextCheckAt = new Date(now + SCHEDULER_STALE_MS).toISOString();
    await storage.put(SCHEDULER_HEALTH_KEY, health);
    if (env.CRON_CONFIGURED === "true") await storage.setAlarm(now + SCHEDULER_STALE_MS);
    return json({ health });
  }
  if (request.method === "POST" && pathname === "/mark") {
    const marker = await request.json() as SchedulerMarker;
    const kinds: SchedulerMarkerKind[] = [
      "scheduled_received", "monitoring_started", "monitoring_completed", "monitoring_failed",
      "web_scout_started", "web_scout_completed", "web_scout_failed",
      "automatic_heartbeat_started", "automatic_heartbeat_completed", "automatic_heartbeat_failed",
      "manual_heartbeat_started", "manual_heartbeat_completed", "manual_heartbeat_failed",
      "fallback_monitoring_started", "fallback_monitoring_completed", "fallback_monitoring_failed",
      "fallback_web_scout_started", "fallback_web_scout_completed", "fallback_web_scout_failed"
    ];
    if (!kinds.includes(marker.kind) || !Number.isFinite(marker.scheduledTime)) {
      return json({ error: "Marqueur scheduler invalide." }, 400);
    }
    const previous = await storage.get<SchedulerHealth>(SCHEDULER_HEALTH_KEY);
    const health = applySchedulerMarker(previous, marker);
    if (!health.armedAt) health.armedAt = new Date(safeTime(marker.observedTime)).toISOString();
    await storage.put(SCHEDULER_HEALTH_KEY, health);
    if (marker.kind === "scheduled_received" && env.CRON_CONFIGURED === "true") {
      const receivedAt = Date.parse(health.lastScheduledEvent!.receivedAt);
      await storage.setAlarm(receivedAt + SCHEDULER_STALE_MS);
    }
    return json({ health });
  }
  return undefined;
}

export async function handleSchedulerWatchdogAlarm(
  storage: DurableObjectStorage,
  env: SchedulerHealthEnv,
  now = Date.now()
): Promise<{ stale: boolean }> {
  const health = (await storage.get<SchedulerHealth>(SCHEDULER_HEALTH_KEY)) ?? initialHealth();
  health.watchdog.lastCheckedAt = new Date(now).toISOString();

  if (env.SCHEDULER_MODE !== "live" || env.CRON_CONFIGURED !== "true") {
    health.watchdog.status = "disabled";
    delete health.watchdog.nextCheckAt;
    await storage.put(SCHEDULER_HEALTH_KEY, health);
    return { stale: false };
  }

  const lastReceived = health.lastScheduledEvent ? Date.parse(health.lastScheduledEvent.receivedAt) : Number.NaN;
  const reference = Number.isFinite(lastReceived) ? lastReceived : Date.parse(health.armedAt ?? "");
  const stale = !Number.isFinite(reference) || now - reference >= SCHEDULER_STALE_MS;
  if (!stale) {
    const nextCheck = reference + SCHEDULER_STALE_MS;
    health.watchdog.status = "healthy";
    health.watchdog.nextCheckAt = new Date(nextCheck).toISOString();
    await storage.put(SCHEDULER_HEALTH_KEY, health);
    await storage.setAlarm(nextCheck);
    return { stale: false };
  }

  health.watchdog.status = "stale";
  const lastAlert = Date.parse(health.watchdog.lastAlertAt ?? "");
  if (!Number.isFinite(lastAlert) || now - lastAlert >= SCHEDULER_WATCHDOG_REPEAT_MS) {
    const delivery = await dispatchDiscordPayloads([watchdogPayload(health, now)], env);
    health.watchdog.lastAlertAt = new Date(now).toISOString();
    health.watchdog.lastAlertDelivered = delivery.sent === 1;
    const error = delivery.errors.join(" | ").slice(0, 900);
    if (error) health.watchdog.lastAlertError = error;
    else delete health.watchdog.lastAlertError;
  }

  // Tant que le cron reste silencieux, l'alarme sert aussi de cadence de
  // secours minute. L'alerte Discord reste, elle, limitée à une par heure.
  const nextCheck = now + 60_000;
  health.watchdog.nextCheckAt = new Date(nextCheck).toISOString();
  await storage.put(SCHEDULER_HEALTH_KEY, health);
  await storage.setAlarm(nextCheck);
  return { stale: true };
}
