type ShopifyVariant = {
  price?: string;
  available?: boolean;
};

type ShopifyImage = {
  src?: string;
};

type ShopifyProduct = {
  title?: string;
  handle?: string;
  body_html?: string;
  variants?: ShopifyVariant[];
  images?: ShopifyImage[];
};

type ShopifyCollection = {
  products?: ShopifyProduct[];
};

const SOURCE = "https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function euroPrice(value?: string): string {
  if (!value) return "";
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "";
  return `${parsed.toFixed(2).replace(".", ",")} €`;
}

function productHtml(product: ShopifyProduct): string {
  const title = product.title?.trim() ?? "";
  const handle = product.handle?.trim() ?? "";
  if (!title || !handle) return "";

  const variants = product.variants ?? [];
  const available = variants.some((variant) => variant.available === true);
  const prices = variants
    .map((variant) => variant.price)
    .filter((price): price is string => Boolean(price));
  const minPrice = prices
    .map((price) => Number.parseFloat(price))
    .filter((price) => Number.isFinite(price))
    .sort((a, b) => a - b)[0];
  const price = Number.isFinite(minPrice) ? euroPrice(String(minPrice)) : "";
  const image = product.images?.[0]?.src ?? "";
  const productUrl = `https://ludisphere.fr/products/${encodeURIComponent(handle)}`;

  return [
    '<article class="opwatch-product">',
    `<h2><a href="${escapeHtml(productUrl)}">${escapeHtml(title)}</a></h2>`,
    image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : "",
    `<p>One Piece Card Game ${escapeHtml(title)} ${available ? "En stock Disponible Ajouter au panier" : "Rupture de stock Produit épuisé"} ${escapeHtml(price)}</p>`,
    "</article>"
  ].join("");
}

export default {
  async fetch(): Promise<Response> {
    const response = await fetch(SOURCE, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "OPWatch/1.0 (+personal read-only stock monitor)"
      }
    });

    if (!response.ok) {
      return new Response(`Ludisphere feed upstream HTTP ${response.status}`, { status: 502 });
    }

    const data = await response.json<ShopifyCollection>();
    const products = Array.isArray(data.products) ? data.products : [];
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ludisphere One Piece normalized feed</title></head><body><h1>One Piece Card Game Ludisphere</h1>${products.map(productHtml).join("")}</body></html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=30",
        "x-opwatch-upstream": SOURCE,
        "x-opwatch-products": String(products.length)
      }
    });
  }
};
