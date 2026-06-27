import { writeFile } from "node:fs/promises";

const url = "https://en.fantasysphere.net/sitemap_index.xml";
const started = performance.now();
const response = await fetch(url, {
  redirect: "follow",
  headers: {
    "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only sitemap probe)",
    "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.5"
  }
});

const body = await response.text();
const locations = [...body.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);

const report = {
  checkedAt: new Date().toISOString(),
  url,
  finalUrl: response.url,
  status: response.status,
  contentType: response.headers.get("content-type"),
  responseBytes: new TextEncoder().encode(body).byteLength,
  durationMs: Math.round(performance.now() - started),
  locations
};

console.log(JSON.stringify(report, null, 2));
await writeFile("fantasy-sitemap-probe.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!response.ok || locations.length === 0) {
  process.exitCode = 1;
}
