import { writeFile } from "node:fs/promises";

const urls = [
  "https://en.fantasysphere.net/?s=OP17",
  "https://en.fantasysphere.net/search?search_query=OP17",
  "https://en.fantasysphere.net/search?q=OP17",
  "https://en.fantasysphere.net/recherche?controller=search&s=OP17",
  "https://en.fantasysphere.net/recherche?q=OP17",
  "https://en.fantasysphere.net/sitemap.xml",
  "https://en.fantasysphere.net/sitemap_index.xml",
  "https://en.fantasysphere.net/1_index_sitemap.xml"
];

const targetSlug = "booster-op17-one-piece-cg-op-17-fr-10042439";
const results = [];

for (const [index, url] of urls.entries()) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400));

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TCGWatcherAudit/0.1 (+personal read-only source probe)",
        "Accept": "text/html,application/xml,text/xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
      }
    });

    const body = await response.text();
    const normalized = body.toLowerCase();
    const result = {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      responseBytes: new TextEncoder().encode(body).byteLength,
      durationMs: Math.round(performance.now() - started),
      containsTargetSlug: normalized.includes(targetSlug),
      containsOp17: /\bop[-\s]?17\b/i.test(body),
      productLinks: (body.match(/\/product\//gi) ?? []).length
    };

    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = {
      url,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error)
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    clearTimeout(timeout);
  }
}

await writeFile(
  "fantasy-source-probe.json",
  `${JSON.stringify({ checkedAt: new Date().toISOString(), requestCount: urls.length, results }, null, 2)}\n`,
  "utf8"
);
