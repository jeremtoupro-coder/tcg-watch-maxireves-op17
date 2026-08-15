import { writeFile } from "node:fs/promises";
import type { SchedulerHealth } from "../src/schedulerHealth";

const baseUrl = (process.env.RUNTIME_TEST_URL?.trim() || "").replace(/\/$/, "");
const token = process.env.PREVIEW_AUDIT_TOKEN?.trim() || "";
if (!baseUrl || !token) throw new Error("RUNTIME_TEST_URL et PREVIEW_AUDIT_TOKEN sont obligatoires.");

interface HealthResponse {
  configured?: boolean;
  health?: SchedulerHealth | null;
  observed?: { observedRecently?: boolean; status?: string };
  error?: string;
}

async function readHealth(): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/scheduler-health?test=${Date.now()}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const raw = await response.text();
  let data: HealthResponse;
  try { data = JSON.parse(raw) as HealthResponse; } catch { throw new Error(`Scheduler health non JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(data.error ?? `Scheduler health HTTP ${response.status}`);
  return data;
}

async function waitForHealthRoute(): Promise<HealthResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { return await readHealth(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw lastError ?? new Error("Route scheduler health inaccessible.");
}

const initial = await waitForHealthRoute();
const initialReceived = initial.health?.receivedCount ?? 0;
const initialCompleted = initial.health?.monitoringCompletedCount ?? 0;
// Cloudflare documente jusqu'à 15 minutes de propagation après une
// modification de Cron Trigger. Le test laisse cette fenêtre complète, puis
// exige toujours deux minutes distinctes réellement reçues et terminées.
const deadline = Date.now() + 16 * 60_000;
let final = initial;

while (Date.now() < deadline) {
  final = await readHealth();
  const received = final.health?.receivedCount ?? 0;
  const completed = final.health?.monitoringCompletedCount ?? 0;
  const recentCompleted = (final.health?.recentAutomaticMonitoring ?? [])
    .filter((run) => run.status === "completed")
    .slice(-2);
  const distinctRuns = new Set(recentCompleted.map((run) => run.scheduledAt)).size;
  if (
    final.configured === true &&
    final.observed?.observedRecently === true &&
    received >= initialReceived + 2 &&
    completed >= initialCompleted + 2 &&
    recentCompleted.length === 2 &&
    distinctRuns === 2
  ) {
    const report = {
      generatedAt: new Date().toISOString(),
      environment: "isolated-runtime-test",
      cron: "* * * * *",
      schedulerMode: "test",
      discordMode: "dry-run",
      productionStateWrites: false,
      initialReceived,
      finalReceived: received,
      initialCompleted,
      finalCompleted: completed,
      observed: final.observed,
      consecutiveCompletedRuns: recentCompleted,
      verdict: "PASS"
    };
    await writeFile("scheduler-test-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: "isolated-runtime-test",
  initialReceived,
  initialCompleted,
  final,
  verdict: "FAIL"
};
await writeFile("scheduler-test-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
throw new Error("Deux Scheduled Events automatiques successifs et terminés n'ont pas été observés en seize minutes.");
