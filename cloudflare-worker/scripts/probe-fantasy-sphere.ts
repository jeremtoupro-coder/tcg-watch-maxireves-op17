import { writeFile } from "node:fs/promises";

const baseUrl = "https://en.fantasysphere.net";
const targetPattern = /(OP[-_\s]?17|OP[-_\s]?18|IB[-_\s]?0?7|IB[-_\s]?0?8)/i;
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

interface ProductPageDiagnostic {
  url: string;
  status?: number;
  bytes?: number;
  title?: string;
  h1?: string;
  jsonLdProducts: unknown[];
  availabilityMentions: string[];
  error?: string;
}

function extractLocs(text: string): string[] {
  return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

function stripTags(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
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
        "Accept": "text/html,application/xml,text/xml,text/plain,*/*"
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

function collectProductObjects(value: unknown, output: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectProductObjects(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
    output.push(record);
  }

  for (const child of Object.values(record)) collectProductObjects(child, output);
}

async function inspectProductPage(url: string): Promise<ProductPageDiagnostic> {
  const diagnostic: ProductPageDiagnostic = {
    url,
    jsonLdProducts: [],
    availabilityMentions: []
  };

  try {
    const fetched = await fetchText(url);
    diagnostic.status = fetched.status;
    diagnostic.bytes = fetched.bytes;
    diagnostic.title = stripTags(fetched.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    diagnostic.h1 = stripTags(fetched.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");

    for (const match of fetched.text.matchAll(
      /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi
    )) {
      try {
        collectProductObjects(JSON.parse(match[2]), diagnostic.jsonLdProducts);
      } catch {
        // Certains sites publient plusieurs objets non JSON dans le même bloc.
      }
    }

    const plainText = stripTags(fetched.text);
    const mentions = plainText.match(
      /(?:in stock|out of stock|available|unavailable|pre-?order|en stock|rupture de stock|indisponible|précommande)/gi
    ) ?? [];
    diagnostic.availabilityMentions = [...new Set(mentions.map((value) => value.toLowerCase()))];
  } catch (error) {
    diagnostic.error = error instanceof Error ? error.message : String(error);
  }

  return diagnostic;
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
        let decoded = loc;
        try {
          decoded = decodeURIComponent(loc);
        } catch {
          // Une URL mal encodée reste testée telle quelle.
        }
        if (targetPattern.test(decoded)) {
          result.targetUrls.push(loc);
          allTargetUrls.add(loc);
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  result.targetUrls = [...new Set(result.targetUrls)];
  results.push(result);
}

const englishTargets = [...allTargetUrls]
  .filter((url) => url.startsWith("https://en.fantasysphere.net/product/"))
  .sort();

const representativeTargets = [
  englishTargets.find((url) => /op17.*-fr-/i.test(url)),
  englishTargets.find((url) => /op18.*-fr-/i.test(url)),
  englishTargets.find((url) => /ib-07/i.test(url))
].filter((url): url is string => Boolean(url));

const productPages: ProductPageDiagnostic[] = [];
for (const url of representativeTargets) {
  productPages.push(await inspectProductPage(url));
}

const report = {
  mode: "READ_ONLY_FANTASY_SPHERE_SITEMAP_PROBE",
  checkedAt: new Date().toISOString(),
  documentsVisited: visited.size,
  targets: englishTargets,
  productPages,
  results
};

await writeFile(
  "fantasy-sphere-probe.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

console.log(`Documents sondés: ${visited.size}`);
console.log(`URLs anglaises cibles trouvées: ${englishTargets.length}`);
console.log(`Pages produit inspectées: ${productPages.length}`);
