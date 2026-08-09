import { writeFile } from "node:fs/promises";

const targets: Record<string, string[]> = {
  ludisphere: [
    "https://ludisphere.fr/collections/one-piece-card-game-precommande",
    "https://ludisphere.fr/products/one-piece-op17-display-24-boosters-jcc-fr",
    "https://ludisphere.fr/collections/one-piece-card-game-precommande/products.json?limit=250"
  ],
  playin: [
    "https://www.play-in.com/fr/gamme/24/one-piece/catalogue",
    "https://www.play-in.com/fr/produit/646300/display-de-24-boosters-op-16-l-heure-de-la-bataille-decisive-one-piece-fr"
  ],
  cultura: [
    "https://www.cultura.com/cartes-a-jouer/cartes-one-piece.html",
    "https://www.cultura.com/p-booster-one-piece-op16-l-heure-de-la-bataille-decisive-13080126.html"
  ],
  micromania: [
    "https://www.micromania.fr/on/demandware.store/Sites-Micromania-Site/default/Search-Show?q=one%20piece%20booster",
    "https://www.micromania.fr/on/demandware.store/Sites-Micromania-Site/default/Search-UpdateGrid?q=one%20piece%20booster",
    "https://www.micromania.fr/cartes-one-piece-op13.html"
  ],
  fnac: [
    "https://www.fnac.com/Cartes-a-collectionner-One-Piece-OP16-Booster-Blister/a23123796/w-4",
    "https://www.fnac.com/sitemapindex-master.xml"
  ],
  carrefour: [
    "https://www.carrefour.fr/s?q=one%20piece%20booster",
    "https://www.carrefour.fr/p/cartes-booster-one-piece-op14-les-sept-de-la-mer-d-azur-bandai-4582769923166"
  ],
  "king-jouet": [
    "https://www.king-jouet.com/jeu-jouet/jeux-societes/cartes-a-collectionner/ref-1034198-cartes-one-piece-booster-op16-heure-de-la-bataille-decisive.htm",
    "https://api.king-jouet.com/",
    "https://api.king-jouet.com/V1/stockItems/1034198",
    "https://api.king-jouet.com/rest/V1/stockItems/1034198",
    "https://api.king-jouet.com/api/catalogue/articles/1034198/data",
    "https://api.king-jouet.com/api/catalogue/articles/4582770058703/data"
  ],
  otakuland: [
    "https://otakuland.fr/one-piece-merch/",
    "https://otakuland.fr/wp-json/wc/store/v1/products?search=one%20piece&per_page=20"
  ]
};

const challengePatterns = [
  /just a moment/i,
  /captcha/i,
  /robot check/i,
  /verify (?:you are|that you are) human/i,
  /access denied/i,
  /challenge-platform/i,
  /captcha-delivery\.com/i
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const results: any[] = [];
for (const [store, urls] of Object.entries(targets)) {
  for (const url of urls) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)",
          "Accept": "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6"
        }
      });
      clearTimeout(timeout);
      const text = (await response.text()).slice(0, 1_000_000);
      const title = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const challenge = challengePatterns.find((p) => p.test(text))?.source;
      const item = {
        store,
        url,
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type"),
        bytesSampled: text.length,
        durationMs: Date.now() - started,
        hasOnePiece: /one[\s-]*piece/i.test(text),
        challenge: challenge ?? null,
        title: title ?? null,
        bodyPrefix: text.slice(0, 300).replace(/\s+/g, " ")
      };
      results.push(item);
      console.log(JSON.stringify(item));
    } catch (error) {
      const item = { store, url, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
      results.push(item);
      console.log(JSON.stringify(item));
    }
    await sleep(750);
  }
}

await writeFile("eight-store-github-egress.json", JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
