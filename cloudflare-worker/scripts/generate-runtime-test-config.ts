import { readFile, writeFile } from "node:fs/promises";

interface WranglerConfig {
  [key: string]: unknown;
  vars?: Record<string, string>;
}

const runId = process.env.RUNTIME_TEST_RUN_ID?.trim();
if (!runId) throw new Error("RUNTIME_TEST_RUN_ID est obligatoire.");
const schedulerTest = process.env.RUNTIME_TEST_SCHEDULER_MODE === "true";

const base = JSON.parse(await readFile("wrangler.jsonc", "utf8")) as WranglerConfig;
const vars = {
  ...(base.vars ?? {}),
  MONITORING_ENABLED: "true",
  WRITE_STATE: "true",
  DISCORD_MODE: "dry-run",
  SCHEDULER_MODE: schedulerTest ? "test" : "disabled",
  CRON_CONFIGURED: schedulerTest ? "true" : "false",
  RUNTIME_TEST_MODE: "true",
  RUNTIME_TEST_RUN_ID: runId,
  PRODUCTION_PROBE_MODE: "true",
  ALLOW_PUBLIC_AUDIT: "false"
};

const generated: WranglerConfig = {
  ...base,
  name: process.env.RUNTIME_TEST_WORKER_NAME?.trim() || "tcg-watch-one-piece-runtime-test",
  vars,
  durable_objects: {
    bindings: [
      { name: "STORE_MONITORS", class_name: "StoreMonitorDurableObject" },
      { name: "CALENDAR_COORDINATOR", class_name: "CalendarCoordinatorDurableObject" }
    ]
  },
  migrations: [
    {
      tag: "op-watch-runtime-do-v1",
      new_sqlite_classes: ["StoreMonitorDurableObject", "CalendarCoordinatorDurableObject"]
    }
  ],
  triggers: { crons: schedulerTest ? ["* * * * *"] : [] }
};

delete generated.kv_namespaces;

await writeFile("wrangler.runtime-test.generated.json", `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(`Runtime test config generated: worker=${String(generated.name)}, run=${runId}, cron=${schedulerTest ? "* * * * *" : "disabled"}, discord=dry-run`);
