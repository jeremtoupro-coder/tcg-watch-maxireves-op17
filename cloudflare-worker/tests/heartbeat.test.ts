import { describe, expect, it } from "vitest";
import { buildRuntimeHeartbeatPayload, isHeartbeatTick } from "../src/heartbeat";
import type { DurableCycleResult } from "../src/durableMonitoring";

function cycle(overrides: Partial<DurableCycleResult> = {}): DurableCycleResult {
  return {
    mode: "live",
    scheduledTime: Date.UTC(2026, 7, 10, 12, 0, 0),
    discovery: false,
    calendarDurationMs: 10,
    storeDurationMs: 20,
    durableDurationMs: 30,
    durableRequestCount: 4,
    stores: [
      { store: "parkage", status: "completed", durationMs: 10, merchantDurationMs: 8 },
      { store: "leclerc", status: "completed", durationMs: 10, merchantDurationMs: 8 }
    ],
    pendingAuthorizedFeedStores: ["fnac", "cultura"],
    deferredDiscoveryStores: [],
    ...overrides
  };
}

describe("heartbeat 12h", () => {
  it("ne se déclenche que sur une fenêtre de 12h", () => {
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 0, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 12, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 12, 1, 0))).toBe(false);
  });

  it("construit un heartbeat vert après un cycle sain", () => {
    const payload = buildRuntimeHeartbeatPayload(cycle());
    expect(payload.embeds[0].title).toContain("tourne normalement");
    expect(payload.embeds[0].fields.some((field) => field.name === "✅ Boutiques OK" && field.value === "2")).toBe(true);
    expect(payload.embeds[0].fields.some((field) => field.name === "🟠 En attente partenaire" && field.value === "2")).toBe(true);
  });

  it("signale les incidents dans le heartbeat", () => {
    const payload = buildRuntimeHeartbeatPayload(cycle({
      stores: [
        { store: "parkage", status: "completed", durationMs: 10, merchantDurationMs: 8 },
        { store: "amazon", status: "degraded", durationMs: 10, merchantDurationMs: 8, error: "HTTP 503" }
      ]
    }));
    expect(payload.embeds[0].title).toContain("1 incident");
    expect(payload.embeds[0].fields.find((field) => field.name === "Détail")?.value).toContain("amazon");
  });
});
