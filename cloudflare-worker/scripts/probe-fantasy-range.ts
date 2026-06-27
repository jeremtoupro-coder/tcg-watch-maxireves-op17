import { writeFile } from "node:fs/promises";

const url = "https://www.fantasysphere.net/sitemaps/sitemap_products_5.xml";
const targetSlug = "booster-op17-one-piece-cg-op-17-fr-10042439";

const headStarted = performance.now();
const headResponse = await fetch(url, {
  method: "HEAD",
  redirect: "follow",
  headers: {
    "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only range probe)"
  }
});

const head = {
  status: headResponse.status,
  durationMs: Math.round(performance.now() - headStarted),
  acceptRanges: headResponse.headers.get("accept-ranges"),
  contentLength: headResponse.headers.get("content-length"),
  etag: headResponse.headers.get("etag"),
  lastModified: headResponse.headers.get("last-modified")
};

await new Promise((resolve) => setTimeout(resolve, 500));

const rangeStarted = performance.now();
const rangeResponse = await fetch(url, {
  redirect: "follow",
  headers: {
    "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only range probe)",
    "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.5",
    "Range": "bytes=-3000000"
  }
});

const body = await rangeResponse.text();
const locations = [...body.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);

const matchingLocations = locations.filter((location) =>
  /(?:op[-\s]?17|op[-\s]?18|ib[-\s]?0?[78]|illustration[-\s]?box)/i.test(location)
);

const range = {
  status: rangeResponse.status,
  durationMs: Math.round(performance.now() - rangeStarted),
  responseBytes: new TextEncoder().encode(body).byteLength,
  contentRange: rangeResponse.headers.get("content-range"),
  acceptRanges: rangeResponse.headers.get("accept-ranges"),
  contentLength: rangeResponse.headers.get("content-length"),
  etag: rangeResponse.headers.get("etag"),
  lastModified: rangeResponse.headers.get("last-modified"),
  containsTargetSlug: body.toLowerCase().includes(targetSlug),
  locationCount: locations.length,
  matchingLocations
};

const report = {
  checkedAt: new Date().toISOString(),
  url,
  head,
  range
};

console.log(JSON.stringify(report, null, 2));
await writeFile("fantasy-range-probe.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
