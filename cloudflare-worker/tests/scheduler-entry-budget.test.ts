import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeEntry = readFileSync(new URL("../src/runtimeEntry.ts", import.meta.url), "utf8");
const durableMonitoring = readFileSync(new URL("../src/durableMonitoring.ts", import.meta.url), "utf8");

describe("budget CPU du Scheduled Handler", () => {
  it("remet le cycle marchand au Durable Object sans parser les réponses boutiques", () => {
    const scheduledHandler = runtimeEntry.slice(runtimeEntry.indexOf("scheduled(controller:"));
    expect(scheduledHandler).toContain("handOffScheduledMonitoring(");
    expect(scheduledHandler).not.toContain("runDistributedMonitoringCycle(");
    expect(scheduledHandler).not.toContain("response.json(");
    expect(scheduledHandler).not.toContain("isWebScoutTick(");
    expect(scheduledHandler).not.toContain("safeSchedulerMark(");
  });

  it("conserve le heartbeat pré-cycle dans l'orchestrateur DO", () => {
    const route = durableMonitoring.slice(
      durableMonitoring.indexOf("private async runDeliveredScheduledEvent"),
      durableMonitoring.indexOf("async fetch(request:", durableMonitoring.indexOf("private async runDeliveredScheduledEvent"))
    );
    expect(route.indexOf("dispatchRuntimeHeartbeatSignal(")).toBeGreaterThan(0);
    expect(route.indexOf("runDistributedMonitoringCycle(")).toBeGreaterThan(route.indexOf("dispatchRuntimeHeartbeatSignal("));
    expect(route).toContain("runDeliveredWebScout(");
  });

  it("ne double plus les écritures Discovery et backoff à chaque minute", () => {
    expect(durableMonitoring).not.toContain("forceDiscoveryDue(");
    expect(durableMonitoring).not.toContain("pruneFastWatchCache(");
    expect(durableMonitoring).toContain("forceDiscovery: input.forceDiscovery === true");
    expect(durableMonitoring).toContain('backoffRaw && backoffRaw !== "1970-01-01T00:00:00.000Z"');
  });
});
