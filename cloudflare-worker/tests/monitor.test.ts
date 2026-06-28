import { describe, expect, it } from "vitest";
import {
  buildMonitoringTasks,
  parseActiveStores,
  runMonitoringCycle,
  selectScheduledStore,
  selectScheduledTask
} from "../src/monitor";

describe("surveillance planifiée", () => {
  it("utilise les quatre boutiques Cloudflare par défaut", () => {
    expect(parseActiveStores()).toEqual([
      "maxireves",
      "ludotrotter",
      "oupi",
      "fantasy-sphere"
    ]);
  });

  it("ignore les boutiques inconnues et supprime les doublons", () => {
    expect(parseActiveStores("oupi,inconnue,oupi,maxireves")).toEqual([
      "oupi",
      "maxireves"
    ]);
  });

  it("répartit une liste simple par minute", () => {
    const stores = ["maxireves", "ludotrotter", "oupi"] as const;
    expect(selectScheduledStore([...stores], 0)).toBe("maxireves");
    expect(selectScheduledStore([...stores], 60_000)).toBe("ludotrotter");
    expect(selectScheduledStore([...stores], 120_000)).toBe("oupi");
    expect(selectScheduledStore([...stores], 180_000)).toBe("maxireves");
  });

  it("construit neuf tâches avec deux fiches Fantasy Sphere maximum", () => {
    const tasks = buildMonitoringTasks(parseActiveStores());
    expect(tasks).toHaveLength(9);
    expect(tasks.slice(0, 3).map((task) => task.store)).toEqual([
      "maxireves",
      "ludotrotter",
      "oupi"
    ]);

    const fantasyTasks = tasks.filter((task) => task.store === "fantasy-sphere");
    expect(fantasyTasks).toHaveLength(6);
    expect(fantasyTasks.every((task) => task.connector.sources.length <= 2)).toBe(true);
    expect(fantasyTasks.map((task) => task.batchIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("effectue un cycle complet en neuf minutes", () => {
    const tasks = buildMonitoringTasks(parseActiveStores());
    expect(selectScheduledTask(tasks, 0)?.store).toBe("maxireves");
    expect(selectScheduledTask(tasks, 60_000)?.store).toBe("ludotrotter");
    expect(selectScheduledTask(tasks, 120_000)?.store).toBe("oupi");
    expect(selectScheduledTask(tasks, 180_000)?.store).toBe("fantasy-sphere");
    expect(selectScheduledTask(tasks, 480_000)?.batchIndex).toBe(5);
    expect(selectScheduledTask(tasks, 540_000)?.store).toBe("maxireves");
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
