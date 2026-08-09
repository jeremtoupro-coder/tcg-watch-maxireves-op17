import { writeFile } from "node:fs/promises";

const urls = [
  "https://cataleeze.king-jouet.com/v2/animation/catalogue/list",
  "https://cataleeze.king-jouet.com/api/animation/catalogue/list",
  "https://cataleeze.king-jouet.com/v2/animation/catalogue/list?format=json"
];

const results = [];
for (const url of urls) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
        "Accept": "application/json,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9"
      },
      signal: AbortSignal.timeout(20_000)
    });
    const text = await response.text();
    const item = {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: text.length,
      prefix: text.slice(0, 3000)
    };
    results.push(item);
    console.log(JSON.stringify(item, null, 2));
  } catch (error) {
    const item = { url, error: error instanceof Error ? error.message : String(error) };
    results.push(item);
    console.log(JSON.stringify(item, null, 2));
  }
}

await writeFile("king-cataleeze-probe.json", JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
