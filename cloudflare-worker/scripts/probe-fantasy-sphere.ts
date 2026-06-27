import { writeFile } from "node:fs/promises";

const baseUrl = "https://en.fantasysphere.net";
const targetPattern = /(OP[-_\s]?17|OP[-_\s]?18|IB[-_\s]?0?7|IB[-_\s]?0?8|Illustration[^<\n]{0,40}(?:Vol(?:ume)?\.?\s*)?[78])/i;
const MAX_DOCUMENTS = 60;
const MAX_BYTES = 25_000_000;

interface ProbeResult {
  url: string;
  status?: number;
  contentType?: string;
  bytes?: number;
  sitemapChildren: string[];
  targetUrls: string[];
  error?: string;
}

function extractLocs(text: string): string[] {
  return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

async function fetchText(url: string): Promise<{ text: string; status: number; contentType: string; bytes: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TCGWatcherSitemapProbe/1.0 (+personal read-only audit)",
        "Accept": "application/xml,text/xml,text/plain,*/*"
      }
    });
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error(`Document trop volumineux: ${buffer.byteLength} octets`);
    }
    return {
      text: new TextDecoder().decode(buffer),
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: buffer.byteLength
    };
  } finally {
    clearTimeout(timeout);
  }
}

const initialUrls = new Set<string>([
  `${baseUrl}/robots.txt`,
  `${baseUrl}/sitemap.xml`,
  `${baseUrl}/1_en_0_sitemap.xml`,
  `${baseUrl}/sitemap_index.xml`,
  `${baseUrl}/sitemap-index.xml`
]);

try {
  const robots = await fetchText(`${baseUrl}/robots.txt`);
  for (const match of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
    initialUrls.add(match[1].trim());
  }
} catch {
  // Les URLs courantes restent sondées même si robots.txt est indisponible.
}

const queue = [...initialUrls];
const visited = new Set<string>();
const results: ProbeResult[] = [];
const allTargetUrls = new Set<string>();

while (queue.length > 0 && visited.size < MAX_DOCUMENTS) {
  const url = queue.shift()!;
  if (visited.has(url)) continue;
  visited.add(url);

  const result: ProbeResult = {
    url,
    sitemapChildren: [],
    targetUrls: []
  };

  try {
    const fetched = await fetchText(url);
    result.status = fetched.status;
    result.contentType = fetched.contentType;
    result.bytes = fetched.bytes;

    if (fetched.status >= 200 && fetched.status < 300) {
      const locs = extractLocs(fetched.text);
      const isSitemapIndex = /<sitemapindex\b/i.test(fetched.text);

      if (isSitemapIndex) {
        result.sitemapChildren = locs;
        const prioritized = [
          ...locs.filter((child) => /product|produit/i.test(child)),
          ...locs.filter((child) => !/product|produit/i.test(child))
        ];
        for (const child of prioritized) {
          if (!visited.has(child) && queue.length + visited.size < MAX_DOCUMENTS) {
            queue.push(child);
          }
        }
      }

      for (const loc of locs) {
        if (targetPattern.test(decodeURIComponent(loc))) {
          result.targetUrls.push(loc);
          allTargetUrls.add(loc);
        }
      }

      if (targetPattern.test(fetched.text)) {
        for (const match of fetched.text.matchAll(/https?:\/\/[^<\s"']+/gi)) {
          const candidate = match[0].replace(/&amp;/g, "&");
          if (targetPattern.test(decodeURIComponent(candidate))) {
            result.targetUrls.push(candidate);
            allTargetUrls.add(candidate);
          }
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  result.targetUrls = [...new Set(result.targetUrls)];
  results.push(result);
}

const report = {
  mode: "READ_ONLY_FANTASY_SPHERE_SITEMAP_PROBE",
  checkedAt: new Date().toISOString(),
  documentsVisited: visited.size,
  targets: [...allTargetUrls].sort(),
  results
};

await writeFile(
  "fantasy-sphere-probe.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

console.log(`Documents sondés: ${visited.size}`);
console.log(`URLs cibles trouvées: ${allTargetUrls.size}`);
for (const url of allTargetUrls) console.log(`- ${url}`);
