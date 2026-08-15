import { readFile, writeFile } from "node:fs/promises";

function flatten(value: unknown, prefix = "", output: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, output));
    return output;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|cookie|password|secret|token|webhook|email|body|headers/i.test(key)) continue;
      flatten(entry, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (/script|trigger|event|outcome|status|cpu|wall|duration|timestamp|datetime|scheduled|message|error|exception|id$/i.test(prefix)) {
    output[prefix] = typeof value === "string" ? value.slice(0, 600) : value;
  }
  return output;
}

const source = process.argv[2] || "production-tail.ndjson";
const target = process.argv[3] || "production-tail-summary.json";
let raw = "";
try {
  raw = await readFile(source, "utf8");
} catch {
  raw = "";
}

const rows = raw.split(/\r?\n/).flatMap((line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    return [flatten(JSON.parse(trimmed))];
  } catch {
    return [];
  }
});

await writeFile(target, `${JSON.stringify({ generatedAt: new Date().toISOString(), events: rows }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ tailEvents: rows.length, scheduledEvents: rows.filter((row) => JSON.stringify(row).toLowerCase().includes("scheduled") || JSON.stringify(row).toLowerCase().includes("cron")).length }));

