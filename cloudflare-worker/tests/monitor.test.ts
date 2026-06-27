import { describe, expect, it } from "vitest";
import {
  parseActiveStores,
  runMonitoringCycle,
  selectScheduledStore
} from "../src/monitor";

describe("surveillance planifiée", () => {
  it("utilise les trois boutiques Cloudflare par défaut", () => {
    expect(parseActiveStores()).toEqual([
      "maxireves",
      "ludotrotter",
      "oupi"
    ]);
  });

  it("ignore les boutiques inconnues et supprime les doublons", () => {
    expect(parseActiveStores("oupi,inconnue,oupi,maxireves")).toEqual([
      "oupi",
      "maxireves"
    ]);
  });

  it("répartit une boutique par minute", () => {
    const stores = ["maxireves", "ludotrotter", "oupi"] as const;
    expect(selectScheduledStore([...stores], 0)).toBe("maxireves");
    expect(selectScheduledStore([...stores], 60_000)).toBe("ludotrotter");
    expect(selectScheduledStore([...stores], 120_000)).toBe("oupi");
    expect(selectScheduledStore([...stores], 180_000)).toBe("maxireves");
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
});
