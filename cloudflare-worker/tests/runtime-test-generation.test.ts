import { describe, expect, it } from "vitest";
import runtimeWorker from "../src/runtimeEntry";
import type { RuntimeEnv } from "../src/durableMonitoring";

const env = {
  RUNTIME_TEST_MODE: "true",
  RUNTIME_TEST_RUN_ID: "run-173",
  PREVIEW_AUDIT_TOKEN: "runtime-token",
  SCHEDULER_MODE: "disabled",
  DISCORD_MODE: "dry-run",
  MONITORING_ENABLED: "true",
  WRITE_STATE: "true"
} as RuntimeEnv;

async function probe(run?: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const url = new URL("https://runtime.test/runtime-test");
  url.searchParams.set("probe", "auth");
  if (run) url.searchParams.set("run", run);
  const response = await runtimeWorker.fetch(new Request(url, {
    headers: { authorization: "Bearer runtime-token" }
  }), env);
  return { response, body: await response.json() as Record<string, unknown> };
}

describe("génération du runtime test isolé", () => {
  it("refuse une génération absente ou remplacée avant tout cycle", async () => {
    expect((await probe()).response.status).toBe(409);
    expect((await probe("run-172")).response.status).toBe(409);
  });

  it("confirme explicitement la génération attendue", async () => {
    const { response, body } = await probe("run-173");
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      mode: "test",
      runtimeTestRunId: "run-173",
      productionStateWrites: false
    });
  });
});
