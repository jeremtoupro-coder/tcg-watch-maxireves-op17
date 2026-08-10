import { describe, expect, it } from "vitest";
import {
  CADENCE_SAMPLE_CYCLES,
  DURABLE_TARGET_GB_SECONDS_PER_DAY,
  assertRuntimeReadiness,
  projectCadenceBudget,
  selectStoresForCycle,
  type RuntimeEnv
} from "../src/durableMonitoring";

function runtimeBindings(): Pick<RuntimeEnv, "STORE_MONITORS" | "CALENDAR_COORDINATOR"> {
  return {
    STORE_MONITORS: {} as DurableObjectNamespace,
    CALENDAR_COORDINATOR: {} as DurableObjectNamespace
  };
}

describe("Fast Watch Durable Objects à budget borné", () => {
  it("ne sollicite pas les six boutiques protégées sans feed et reporte les discovery-only hors quart d'heure", () => {
    const selection = selectStoresForCycle({}, {
      scheduledTime: Date.UTC(2026, 7, 10, 8, 1, 0)
    });

    expect(selection.discovery).toBe(false);
    expect(selection.pendingAuthorizedFeedStores).toEqual([
      "playin",
      "cultura",
      "micromania",
      "fnac",
      "carrefour",
      "king-jouet"
    ]);
    expect(selection.deferredDiscoveryStores).toEqual(["ludiworld", "otakuland"]);
    expect(selection.stores).toHaveLength(13);
  });

  it("inclut Ludiworld et Otakuland uniquement lors de la Discovery", () => {
    const selection = selectStoresForCycle({}, {
      scheduledTime: Date.UTC(2026, 7, 10, 8, 15, 0)
    });

    expect(selection.discovery).toBe(true);
    expect(selection.stores).toHaveLength(15);
    expect(selection.stores).toContain("ludiworld");
    expect(selection.stores).toContain("otakuland");
  });

  it("sépare forceStore de forceDiscovery", () => {
    const fastOnly = selectStoresForCycle({}, {
      scheduledTime: Date.UTC(2026, 7, 10, 8, 1, 0),
      forceStore: "maxireves"
    });
    const discovery = selectStoresForCycle({}, {
      scheduledTime: Date.UTC(2026, 7, 10, 8, 1, 0),
      forceStore: "maxireves",
      forceDiscovery: true
    });

    expect(fastOnly.stores).toEqual(["maxireves"]);
    expect(fastOnly.discovery).toBe(false);
    expect(discovery.stores).toEqual(["maxireves"]);
    expect(discovery.discovery).toBe(true);
  });

  it("projette exactement un échantillon de quinze minutes sur 24 heures et garde la marge cible", () => {
    const cycles = Array.from({ length: CADENCE_SAMPLE_CYCLES }, () => ({
      durableDurationMs: 40_000,
      durableRequestCount: 14
    }));
    const budget = projectCadenceBudget(cycles);

    expect(budget.sampleCycles).toBe(15);
    expect(budget.projectedGbSecondsPerDay).toBeLessThan(DURABLE_TARGET_GB_SECONDS_PER_DAY);
    expect(budget.projectedDurableRequestsPerDay).toBeLessThan(100_000);
    expect(budget.pass).toBe(true);
  });

  it("refuse un PASS si l'échantillon n'a pas exactement une Discovery et quatorze Fast Watch", () => {
    const incomplete = Array.from({ length: CADENCE_SAMPLE_CYCLES - 1 }, () => ({
      durableDurationMs: 1_000,
      durableRequestCount: 1
    }));

    const budget = projectCadenceBudget(incomplete);
    expect(budget.sampleCycles).toBe(14);
    expect(budget.pass).toBe(false);
  });

  it("refuse le verdict PASS au-dessus du plafond opérationnel même sous le quota officiel", () => {
    const cycles = Array.from({ length: CADENCE_SAMPLE_CYCLES }, () => ({
      durableDurationMs: 50_000,
      durableRequestCount: 14
    }));
    const budget = projectCadenceBudget(cycles);

    expect(budget.projectedGbSecondsPerDay).toBeGreaterThan(DURABLE_TARGET_GB_SECONDS_PER_DAY);
    expect(budget.projectedGbSecondsPerDay).toBeLessThan(13_000);
    expect(budget.pass).toBe(false);
  });

  it("refuse un test isolé qui pourrait envoyer sur Discord ou lancer un scheduler", () => {
    expect(() => assertRuntimeReadiness({
      ...runtimeBindings(),
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "live",
      SCHEDULER_MODE: "disabled",
      RUNTIME_TEST_MODE: "true",
      RUNTIME_TEST_RUN_ID: "123"
    }, "test")).toThrow(/dry-run/);

    expect(() => assertRuntimeReadiness({
      ...runtimeBindings(),
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run",
      SCHEDULER_MODE: "live",
      RUNTIME_TEST_MODE: "true",
      RUNTIME_TEST_RUN_ID: "123"
    }, "test")).toThrow(/scheduler/i);
  });

  it("refuse le LIVE si les 21 boutiques et le webhook officiel ne sont pas tous validés", () => {
    expect(() => assertRuntimeReadiness({
      ...runtimeBindings(),
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "live",
      SCHEDULER_MODE: "live",
      ACTIVE_STORES: "maxireves",
      DISCORD_WEBHOOK_URL: "https://example.com/api/webhooks/1/token"
    }, "live")).toThrow(/webhook Discord LIVE/);

    expect(() => assertRuntimeReadiness({
      ...runtimeBindings(),
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "live",
      SCHEDULER_MODE: "live",
      ACTIVE_STORES: "maxireves",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token"
    }, "live")).toThrow(/21 boutiques/);
  });
});
