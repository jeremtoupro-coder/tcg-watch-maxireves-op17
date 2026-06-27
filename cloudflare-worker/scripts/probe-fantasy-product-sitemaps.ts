import { writeFile } from "node:fs/promises";

const urls = [
  "https://www.fantasysphere.net/sitemaps/sitemap_products_5.xml",
  "https://www.fantasysphere.net/sitemaps/sitemap_products_4.xml",
  "https://www.fantasysphere.net/sitemaps/sitemap_products_3.xml",
  "https://www.fantasysphere.net/sitemaps/sitemap_products_2.xml",
  "https://www.fantasysphere.net/sitemaps/sitemap_products.xml"
];

const targetSlug = "booster-op17-one-piece-cg-op-17-fr-10042439";
const results = [];

for (const [index, url] of urls.entries()) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400));

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only sitemap probe)",
        "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.5"
      }
    });

    const body = await response.text();
    const normalized = body.toLowerCase();
    const locations = [...body.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      .map((match) => match[1].trim())
      .filter(Boolean);

    const matchingLocations = locations.filter((location) =>
      /(?:op[-\s]?17|op[-\s]?18|ib[-\s]?0?[78]|illustration[-\s]?box)/i.test(location)
    );

    const result = {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      responseBytes: new TextEncoder().encode(body).byteLength,
      durationMs: Math.round(performance.now() - started),
      locationCount: locations.length,
      containsTargetSlug: normalized.includes(targetSlug),
      matchingLocations
    };

    results.push(result);
    console.log(JSON.stringify(result));

    if (result.containsTargetSlug) break;
  } catch (error) {
    results.push({
      url,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  attemptedRequests: results.length,
  results
};

await writeFile(
  "fantasy-product-sitemaps-probe.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

if (!results.some((result) => "containsTargetSlug" in result && result.containsTargetSlug)) {
  process.exitCode = 2;
}
