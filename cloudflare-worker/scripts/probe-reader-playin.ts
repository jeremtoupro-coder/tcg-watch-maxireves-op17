import { writeFile } from "node:fs/promises";

const url = "https://r.jina.ai/https://www.play-in.com/fr/gamme/24/one-piece/catalogue";
const response = await fetch(url, {
  headers: {
    "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
    "Accept": "text/plain,text/markdown;q=0.9,*/*;q=0.5",
    "Accept-Language": "fr-FR,fr;q=0.9"
  },
  signal: AbortSignal.timeout(30_000)
});
const text = await response.text();
const report = {
  status: response.status,
  contentType: response.headers.get("content-type"),
  bytes: text.length,
  hasOnePiece: /one[\s-]*piece/i.test(text),
  opLinks: [...text.matchAll(/\[[^\]]*(?:OP|EB|PRB|ST|DP)[-\s]?\d{1,2}[^\]]*\]\((https?:\/\/www\.play-in\.com\/fr\/produit\/[^)]+)\)/gi)].slice(0, 20).map((m) => m[1]),
  prefix: text.slice(0, 5000)
};
console.log(JSON.stringify(report, null, 2));
await writeFile("playin-reader-probe.json", JSON.stringify(report, null, 2));
if (!response.ok || !report.hasOnePiece) process.exit(1);
