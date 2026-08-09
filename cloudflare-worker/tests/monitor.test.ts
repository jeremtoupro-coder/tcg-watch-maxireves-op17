import { describe, expect, it } from "vitest";
import { parseActiveStores, runMonitoringCycle } from "../src/monitor";

describe("surveillance planifiée", () => {
  it("utilise les quatre boutiques pilotes OP Watch par défaut", () => {
    expect(parseActiveStores()).toEqual([
      "maxireves",
      "oupi",
      "pixelheart",
      "fantasy-sphere"
    ]);
  });

  it("ignore les boutiques inconnues et supprime les doublons", () => {
    expect(parseActiveStores("oupi,inconnue,oupi,maxireves")).toEqual([
      "oupi",
      "maxireves"
    ]);
  });

  it("ne fait aucune requête lorsque la surveillance est désactivée", async () => {
    const result = await runMonitoringCycle({
      MONITORING_ENABLED: "false",
      WRITE_STATE: "false",
      DISCORD_MODE: "dry-run"
    });

    expect(result.status).toBe("disabled");
  });

  it("refuse une surveillance active sans KV", async () => {
    await expect(runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "true",
      DISCORD_MODE: "dry-run"
    })).rejects.toThrow(/TCG_STATE/);
  });

  it("refuse une surveillance active sans écriture persistante", async () => {
    await expect(runMonitoringCycle({
      MONITORING_ENABLED: "true",
      WRITE_STATE: "false",
      DISCORD_MODE: "dry-run",
      TCG_STATE: {} as KVNamespace
    })).rejects.toThrow(/WRITE_STATE/);
  });
});
