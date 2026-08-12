import { readFile, writeFile } from "node:fs/promises";

interface WranglerConfig {
  [key: string]: unknown;
  vars?: Record<string, string>;
}

type ProductionPhase = "standby" | "armed" | "live";

const phase = process.env.PRODUCTION_PHASE?.trim() as ProductionPhase | undefined;
if (!phase || !["standby", "armed", "live"].includes(phase)) {
  throw new Error("PRODUCTION_PHASE doit valoir standby, armed ou live.");
}

const base = JSON.parse(await readFile("wrangler.jsonc", "utf8")) as WranglerConfig;
const activeStores = base.vars?.ACTIVE_STORES?.trim();
if (!activeStores) throw new Error("ACTIVE_STORES doit être défini dans la configuration de base.");

const armed = phase !== "standby";
const vars = {
  ...(base.vars ?? {}),
  AUDIT_MODE: "true",
  ALLOW_PUBLIC_AUDIT: "false",
  MONITORING_ENABLED: armed ? "true" : "false",
  WRITE_STATE: armed ? "true" : "false",
  DISCORD_MODE: armed ? "live" : "dry-run",
  SCHEDULER_MODE: armed ? "live" : "disabled",
  RUNTIME_TEST_MODE: "false",
  PRODUCTION_PROBE_MODE: armed ? "true" : "false",
  ACTIVE_STORES: activeStores
};

const generated: WranglerConfig = {
  ...base,
  name: process.env.PRODUCTION_WORKER_NAME?.trim() || "tcg-watch-one-piece",
  vars,
  durable_objects: {
    bindings: [
      { name: "STORE_MONITORS", class_name: "StoreMonitorDurableObject" },
      { name: "CALENDAR_COORDINATOR", class_name: "CalendarCoordinatorDurableObject" },
      { name: "WEB_SCOUT", class_name: "WebScoutDurableObject" },
      { name: "COCKPIT_AUTH", class_name: "CockpitAuthDurableObject" }
    ]
  },
  migrations: [
    {
      tag: "op-watch-runtime-do-v1",
      new_sqlite_classes: ["StoreMonitorDurableObject", "CalendarCoordinatorDurableObject"]
    },
    {
      tag: "op-watch-web-scout-do-v1",
      new_sqlite_classes: ["WebScoutDurableObject"]
    },
    {
      tag: "op-watch-cockpit-auth-do-v1",
      new_sqlite_classes: ["CockpitAuthDurableObject"]
    }
  ],
  triggers: {
    crons: phase === "live" ? ["* * * * *"] : []
  }
};

delete generated.kv_namespaces;

const output = `wrangler.production-${phase}.generated.json`;
await writeFile(output, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(
  `Production config generated: phase=${phase}, monitoring=${vars.MONITORING_ENABLED}, ` +
  `discord=${vars.DISCORD_MODE}, cron=${phase === "live" ? "1m" : "disabled"}, webScout=hourly, cockpitAuth=email-session`
);
