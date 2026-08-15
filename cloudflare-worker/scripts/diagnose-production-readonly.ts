import { writeFile } from "node:fs/promises";
import { derivePreviewAuditToken } from "../src/previewCredentials";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
const workerName = process.env.PRODUCTION_WORKER_NAME?.trim() || "tcg-watch-one-piece";
const workerUrl = (process.env.PRODUCTION_URL?.trim() || "https://tcg-watch-one-piece.jeremie-touitou-pro.workers.dev").replace(/\/$/, "");

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont obligatoires.");
}

interface ProbeResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 800);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { nonJson: text.replace(/\s+/g, " ").slice(0, 500) };
  }
}

async function cloudflare(path: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });
    const data = await readJson(response);
    return {
      ok: response.ok && Boolean((data as { success?: boolean } | undefined)?.success ?? true),
      status: response.status,
      data
    };
  } catch (error) {
    return { ok: false, status: 0, error: safeError(error) };
  }
}

async function worker(path: string, authenticated = false): Promise<ProbeResult> {
  try {
    const token = authenticated ? derivePreviewAuditToken(apiToken) : "";
    const response = await fetch(`${workerUrl}${path}${path.includes("?") ? "&" : "?"}diagnostic=${Date.now()}`, {
      headers: authenticated ? { authorization: `Bearer ${token}` } : undefined
    });
    return { ok: response.ok, status: response.status, data: await readJson(response) };
  } catch (error) {
    return { ok: false, status: 0, error: safeError(error) };
  }
}

function envelopeResult(value: ProbeResult): unknown {
  const body = value.data as { result?: unknown; errors?: unknown; messages?: unknown } | undefined;
  return {
    ok: value.ok,
    status: value.status,
    ...(value.error ? { error: value.error } : {}),
    ...(body?.errors ? { errors: body.errors } : {}),
    ...(body?.messages ? { messages: body.messages } : {}),
    ...(body && "result" in body ? { result: body.result } : value.data !== undefined ? { result: value.data } : {})
  };
}

function slimSettings(value: ProbeResult): unknown {
  const envelope = envelopeResult(value) as { result?: Record<string, unknown> };
  const settings = envelope.result;
  if (!settings || typeof settings !== "object") return envelope;
  const bindings = Array.isArray(settings.bindings)
    ? settings.bindings.map((binding) => {
        const item = binding as Record<string, unknown>;
        return { name: item.name, type: item.type, class_name: item.class_name, namespace_id: item.namespace_id };
      })
    : [];
  return {
    ok: value.ok,
    status: value.status,
    result: {
      compatibility_date: settings.compatibility_date,
      compatibility_flags: settings.compatibility_flags,
      usage_model: settings.usage_model,
      observability: settings.observability,
      tail_consumers: settings.tail_consumers,
      bindings
    }
  };
}

function flatten(value: unknown, prefix = "", output: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, output));
    return output;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|cookie|password|secret|token|webhook|email|body/i.test(key)) continue;
      flatten(entry, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (/service|script|trigger|event|outcome|status|cpu|wall|duration|timestamp|datetime|created|message|error|exception|id$/i.test(prefix)) {
    output[prefix] = typeof value === "string" ? value.slice(0, 600) : value;
  }
  return output;
}

function telemetrySummary(value: ProbeResult): unknown {
  const body = value.data as { result?: Record<string, unknown>; errors?: unknown; messages?: unknown } | undefined;
  const result = body?.result;
  const rows = result && typeof result === "object"
    ? ["events", "invocations", "requests", "calculations"].flatMap((key) => {
        const candidate = result[key];
        return Array.isArray(candidate) ? candidate : [];
      })
    : [];
  return {
    ok: value.ok,
    status: value.status,
    ...(body?.errors ? { errors: body.errors } : {}),
    ...(body?.messages ? { messages: body.messages } : {}),
    rows: rows.slice(0, 500).map((row) => flatten(row))
  };
}

const now = Date.now();
const from = now - 3 * 24 * 60 * 60_000;
const basePath = `/workers/scripts/${encodeURIComponent(workerName)}`;

const [account, schedules, deployments, versions, settings, root, readiness, webScoutHealth, telemetryKeys] = await Promise.all([
  cloudflare(""),
  cloudflare(`${basePath}/schedules`),
  cloudflare(`${basePath}/deployments`),
  cloudflare(`${basePath}/versions`),
  cloudflare(`${basePath}/settings`),
  worker("/"),
  worker("/runtime-ready", true),
  worker("/web-scout-health", true),
  cloudflare("/workers/observability/telemetry/keys", {
    method: "POST",
    body: JSON.stringify({ from, to: now, limit: 2000 })
  })
]);

const keysEnvelope = telemetryKeys.data as { result?: Array<{ key?: string; type?: string }> } | undefined;
const keys = Array.isArray(keysEnvelope?.result) ? keysEnvelope.result : [];
const serviceKey = ["$metadata.service", "service.name", "$metadata.scriptName", "scriptName"]
  .find((candidate) => keys.some((entry) => entry.key === candidate));

const telemetry = serviceKey
  ? await cloudflare("/workers/observability/telemetry/query", {
      method: "POST",
      body: JSON.stringify({
        queryId: `op-watch-production-diagnostic-${now}`,
        timeframe: { from, to: now },
        dry: true,
        view: "events",
        limit: 1000,
        parameters: {
          datasets: [],
          filterCombination: "and",
          filters: [{ kind: "filter", key: serviceKey, operation: "eq", type: "string", value: workerName }],
          orderBy: { value: "$metadata.timestamp", order: "desc" }
        }
      })
    })
  : { ok: false, status: 0, error: "Aucune clé de service reconnue dans Workers Observability." } satisfies ProbeResult;

const accountEnvelope = envelopeResult(account) as { result?: Record<string, unknown> };
const accountResult = accountEnvelope.result;
const report = {
  generatedAt: new Date(now).toISOString(),
  readOnly: true,
  worker: workerName,
  account: accountResult && typeof accountResult === "object"
    ? { ok: account.ok, status: account.status, result: { id: accountResult.id, name: accountResult.name, type: accountResult.type, settings: accountResult.settings } }
    : accountEnvelope,
  schedules: envelopeResult(schedules),
  deployments: envelopeResult(deployments),
  versions: envelopeResult(versions),
  settings: slimSettings(settings),
  runtime: {
    root: envelopeResult(root),
    readiness: envelopeResult(readiness),
    webScoutHealth: envelopeResult(webScoutHealth)
  },
  observability: {
    keys: {
      ok: telemetryKeys.ok,
      status: telemetryKeys.status,
      serviceKey,
      relevant: keys.filter((entry) => /service|script|trigger|event|outcome|status|cpu|wall|duration|timestamp|datetime|message|error|exception/i.test(entry.key ?? ""))
    },
    query: telemetrySummary(telemetry)
  }
};

await writeFile("production-diagnostics.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  scheduleApi: { ok: schedules.ok, status: schedules.status },
  deploymentApi: { ok: deployments.ok, status: deployments.status },
  runtimeReady: { ok: readiness.ok, status: readiness.status },
  webScoutHealth: { ok: webScoutHealth.ok, status: webScoutHealth.status },
  observabilityKeys: { ok: telemetryKeys.ok, status: telemetryKeys.status, serviceKey },
  observabilityQuery: { ok: telemetry.ok, status: telemetry.status }
}));

