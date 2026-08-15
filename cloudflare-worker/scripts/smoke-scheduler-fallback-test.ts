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

async function request(path: string, method = "GET"): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}${path}${path.includes("?") ? "&" : "?"}test=${Date.now()}`, {
    method,
    headers: { authorization: `Bearer ${token}` }
  });
  const raw = await response.text();
  let data: HealthResponse;
  try { data = JSON.parse(raw) as HealthResponse; } catch { throw new Error(`${path}: réponse non JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(data.error ?? `${path}: HTTP ${response.status}`);
  return data;
}

const initial = await request("/scheduler-health");
const initialCompleted = initial.health?.fallbackMonitoringCompletedCount ?? 0;
const armed = await request("/scheduler-watchdog/arm", "POST");
const armedAt = Date.parse(armed.health?.armedAt ?? "");
if (!Number.isFinite(armedAt) || armed.health?.watchdog.status !== "armed") {
  throw new Error(`Watchdog isolé non armé: ${JSON.stringify(armed)}`);
}

// Le seuil de production est de trois minutes, puis l'alarme se réarme à une
// minute. Sept minutes couvrent deux cycles complets sans accélérer le runtime.
const deadline = Date.now() + 7 * 60_000;
let final = armed;
while (Date.now() < deadline) {
  final = await request("/scheduler-health");
  const completed = final.health?.fallbackMonitoringCompletedCount ?? 0;
  const last = final.health?.lastFallbackMonitoring;
  if (
    completed >= initialCompleted + 2 &&
    last?.status === "completed" &&
    Date.parse(last.completedAt ?? "") >= armedAt
  ) {
    const report = {
      generatedAt: new Date().toISOString(),
      environment: "isolated-runtime-test",
      trigger: "Durable Object alarm",
      schedulerMode: "test",
      discordMode: "dry-run",
      braveCalls: 0,
      productionStateWrites: false,
      initialCompleted,
      finalCompleted: completed,
      completedDuringTest: completed - initialCompleted,
      lastFallbackMonitoring: last,
      watchdog: final.health?.watchdog,
      cronObserved: final.observed,
      verdict: "PASS"
    };
    await writeFile("scheduler-fallback-test-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: "isolated-runtime-test",
  initialCompleted,
  final,
  verdict: "FAIL"
};
await writeFile("scheduler-fallback-test-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
throw new Error("Deux cycles automatiques de secours par alarme Durable Object n'ont pas été observés en sept minutes.");
