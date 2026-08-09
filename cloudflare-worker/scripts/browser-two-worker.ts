interface Env { BROWSER: Fetcher & { quickAction(action: string, options: unknown): Promise<Response> } }

const targets: Record<string, string> = {
  ludisphere: "https://ludisphere.fr/products/one-piece-op17-display-24-boosters-jcc-fr",
  micromania: "https://www.micromania.fr/cartes-one-piece-op13.html"
};

function stripHtml(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function challengeReason(html: string, text: string): string | undefined {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (/^just a moment/i.test(title) || /^just a moment/i.test(text)) return "Cloudflare challenge";
  if (/geo\.captcha-delivery\.com|captcha-delivery\.com\/captcha/i.test(html)) return "DataDome CAPTCHA";
  if (/verify (?:you are|that you are) human|access denied/i.test(`${title} ${text.slice(0,1500)}`)) return "human verification";
  if (/ERR_[A-Z_]+|The Chromium Authors/i.test(text.slice(0,1500))) return "Chromium network error";
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = url.searchParams.get("store") ?? "";
    const target = targets[store];
    if (!target) return Response.json({ error: "unknown store", stores: Object.keys(targets) }, { status: 400 });
    const response = await env.BROWSER.quickAction("content", {
      url: target,
      gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 },
      rejectResourceTypes: ["image", "media", "font"]
    });
    const raw = await response.text();
    let html = raw;
    try { const parsed = JSON.parse(raw) as { result?: unknown }; if (typeof parsed.result === "string") html = parsed.result; } catch {}
    const text = stripHtml(html);
    const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const h1 = stripHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    const challenge = challengeReason(html, text);
    const primary = `${title} ${h1} ${text.slice(0,12000)}`;
    const result = {
      store, target, browserResponseStatus: response.status, browserResponseOk: response.ok,
      browserMsUsed: response.headers.get("x-browser-ms-used"), bytes: html.length, title, h1,
      hasOnePiece: /one[\s-]*piece/i.test(primary),
      hasOpCode: /\b(?:OP|EB|PRB|ST|DP)[-\s]?\d{1,2}\b/i.test(primary),
      hasPrice: /(?:\d{1,4}[.,]\d{2}\s*€|€\s*\d{1,4}[.,]\d{2})/i.test(primary),
      hasAvailability: /ajouter\s+au\s+panier|en\s+stock|disponible|indisponible|rupture|épuis[ée]|précommande|precommande/i.test(primary),
      challenge: challenge ?? null,
      usable: response.ok && !challenge && /one[\s-]*piece/i.test(primary),
      textPrefix: text.slice(0,800)
    };
    return Response.json(result);
  }
};
