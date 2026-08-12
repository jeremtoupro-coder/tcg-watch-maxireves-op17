import { describe, expect, it } from "vitest";
import { buildRuntimeHeartbeatFailurePayload, buildRuntimeHeartbeatPayload, isHeartbeatTick } from "../src/heartbeat";
import type { DurableCycleResult } from "../src/durableMonitoring";

function cycle(overrides: Partial<DurableCycleResult> = {}): DurableCycleResult {
  return {
    mode: "live",
    scheduledTime: Date.UTC(2026, 7, 10, 20, 0, 0),
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

describe("heartbeat 10h/22h Europe/Paris", () => {
  it("se déclenche à 10h et 22h heure d'été", () => {
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 8, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 20, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 7, 10, 20, 1, 0))).toBe(false);
  });

  it("respecte automatiquement l'heure d'hiver", () => {
    expect(isHeartbeatTick(Date.UTC(2026, 11, 10, 9, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 11, 10, 21, 0, 0))).toBe(true);
    expect(isHeartbeatTick(Date.UTC(2026, 11, 10, 20, 0, 0))).toBe(false);
  });

  it("construit un heartbeat vert après un cycle sain", () => {
    const payload = buildRuntimeHeartbeatPayload(cycle());
    expect(payload.embeds[0].title).toContain("tourne normalement");
    expect(payload.embeds[0].description).toContain("10h00 et 22h00");
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

  it("construit un heartbeat rouge si le cycle global plante avant sa fin", () => {
    const payload = buildRuntimeHeartbeatFailurePayload(Date.UTC(2026, 7, 12, 8, 0, 0), new Error("Bandai calendar timeout"));
    expect(payload.embeds[0].title).toContain("cycle de contrôle en échec");
    expect(payload.embeds[0].description).toContain("heartbeat silencieusement manquant");
    expect(payload.embeds[0].fields.find((field) => field.name === "Erreur")?.value).toContain("Bandai calendar timeout");
  });
});
