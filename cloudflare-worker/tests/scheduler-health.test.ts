import { describe, expect, it } from "vitest";
import {
  SCHEDULER_STALE_MS,
  applySchedulerMarker,
  observedSchedulerState
} from "../src/schedulerHealth";

describe("santé observée du scheduler", () => {
  const scheduledTime = Date.UTC(2026, 7, 15, 10, 0, 0);

  it("ne confond jamais SCHEDULER_MODE=live avec un événement réellement reçu", () => {
    expect(observedSchedulerState(undefined, true, scheduledTime)).toMatchObject({
      status: "never_seen",
      observedRecently: false
    });
    expect(observedSchedulerState(undefined, false, scheduledTime)).toMatchObject({
      status: "disabled",
      observedRecently: false
    });
  });

  it("passe de récent à stale après trois minutes sans tick", () => {
    const health = applySchedulerMarker(undefined, {
      kind: "scheduled_received",
      scheduledTime,
      observedTime: scheduledTime + 1_000
    });
    expect(observedSchedulerState(health, true, scheduledTime + SCHEDULER_STALE_MS)).toMatchObject({
      status: "recent",
      observedRecently: true
    });
    expect(observedSchedulerState(health, true, scheduledTime + SCHEDULER_STALE_MS + 1_001)).toMatchObject({
      status: "stale",
      observedRecently: false
    });
  });

  it("mémorise séparément Fast Watch, Discovery, Web Scout et heartbeats", () => {
    let health = applySchedulerMarker(undefined, {
      kind: "scheduled_received",
      scheduledTime,
      observedTime: scheduledTime + 500
    });
    health = applySchedulerMarker(health, {
      kind: "monitoring_started",
      scheduledTime,
      observedTime: scheduledTime + 1_000,
      discovery: true
    });
    health = applySchedulerMarker(health, {
      kind: "monitoring_completed",
      scheduledTime,
      observedTime: scheduledTime + 11_000,
      discovery: true,
      durationMs: 10_000,
      completedStores: 17,
      incidentStores: 0
    });
    health = applySchedulerMarker(health, {
      kind: "web_scout_completed",
      scheduledTime,
      observedTime: scheduledTime + 12_000,
      durationMs: 3_000
    });
    health = applySchedulerMarker(health, {
      kind: "automatic_heartbeat_completed",
      scheduledTime,
      observedTime: scheduledTime + 900
    });
    health = applySchedulerMarker(health, {
      kind: "manual_heartbeat_completed",
      scheduledTime: scheduledTime + 30_000,
      observedTime: scheduledTime + 40_000
    });

    expect(health.receivedCount).toBe(1);
    expect(health.monitoringCompletedCount).toBe(1);
    expect(health.recentAutomaticMonitoring).toHaveLength(1);
    expect(health.automaticMonitoring).toMatchObject({ status: "completed", completedStores: 17 });
    expect(health.lastFastWatch?.status).toBe("completed");
    expect(health.lastDiscovery?.status).toBe("completed");
    expect(health.lastWebScout?.status).toBe("completed");
    expect(health.lastAutomaticHeartbeat?.status).toBe("completed");
    expect(health.lastManualHeartbeat?.status).toBe("completed");
  });

  it("conserve l'échec automatique sans le confondre avec un heartbeat manuel réussi", () => {
    let health = applySchedulerMarker(undefined, {
      kind: "monitoring_failed",
      scheduledTime,
      observedTime: scheduledTime + 20_000,
      error: "calendar timeout"
    });
    health = applySchedulerMarker(health, {
      kind: "manual_heartbeat_completed",
      scheduledTime: scheduledTime + 60_000,
      observedTime: scheduledTime + 70_000
    });
    expect(health.automaticMonitoring).toMatchObject({ status: "error", error: "calendar timeout" });
    expect(health.consecutiveMonitoringFailures).toBe(1);
    expect(health.lastManualHeartbeat?.status).toBe("completed");
  });

  it("compte séparément les cycles automatiques de secours", () => {
    let health = applySchedulerMarker(undefined, {
      kind: "fallback_monitoring_started",
      scheduledTime,
      observedTime: scheduledTime + 1_000,
      discovery: false
    });
    health = applySchedulerMarker(health, {
      kind: "fallback_monitoring_completed",
      scheduledTime,
      observedTime: scheduledTime + 6_000,
      discovery: false,
      completedStores: 15,
      incidentStores: 2
    });
    expect(health.fallbackMonitoringCompletedCount).toBe(1);
    expect(health.monitoringCompletedCount).toBe(0);
    expect(health.lastFallbackMonitoring).toMatchObject({ status: "completed", completedStores: 15 });
  });
});
