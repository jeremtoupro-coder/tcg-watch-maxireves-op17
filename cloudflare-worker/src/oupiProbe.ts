const TARGETS = [
  "https://oupi.eu/fr/413-precommande-one-piece",
  "https://oupi.eu/fr/414-display-one-piece",
  "https://oupi.eu/fr/display-one-piece/7367-display-op-17-boite-de-booster-francais-one-piece-card-game.html"
] as const;

const HEADER_PROFILES = [
  {
    id: "honest-opwatch",
    headers: {
      "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
      "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
    }
  },
  {
    id: "browser-compatible",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPWatch/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.5",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Upgrade-Insecure-Requests": "1"
    }
  }
] as const;

export interface OupiProbeResult {
  target: string;
  profile: string;
  status?: number;
  ok: boolean;
  finalUrl?: string;
  contentType?: string;
  server?: string;
  cfRay?: string;
  bytes?: number;
  hasOnePiece?: boolean;
  hasOp17?: boolean;
  hasFrench?: boolean;
  hasOutOfStock?: boolean;
  hasPrice11980?: boolean;
  error?: string;
}

export async function probeOupiFromWorker(): Promise<OupiProbeResult[]> {
  const results: OupiProbeResult[] = [];

  for (const target of TARGETS) {
    for (const profile of HEADER_PROFILES) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(target, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: profile.headers
        });
        const text = await response.text();
        const normalized = text.toLowerCase();
        results.push({
          target,
          profile: profile.id,
          status: response.status,
          ok: response.ok,
          finalUrl: response.url || target,
          contentType: response.headers.get("content-type") ?? undefined,
          server: response.headers.get("server") ?? undefined,
          cfRay: response.headers.get("cf-ray") ?? undefined,
          bytes: new TextEncoder().encode(text).byteLength,
          hasOnePiece: normalized.includes("one piece"),
          hasOp17: normalized.includes("op-17") || normalized.includes("op17"),
          hasFrench: normalized.includes("français") || normalized.includes("francais"),
          hasOutOfStock: normalized.includes("rupture de stock") || normalized.includes("out of stock"),
          hasPrice11980: normalized.includes("119,80") || normalized.includes("119.80")
        });
      } catch (error) {
        results.push({
          target,
          profile: profile.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  return results;
}
