const fs = require('fs');
const path = 'src/audit.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('function normalizeLudisphereShopifyJson(')) {
  console.log('Ludisphere JSON parser already installed.');
  process.exit(0);
}

const helperAnchor = 'function buildRequestHeaders(connector: ConnectorDefinition): Record<string, string> {';
if (!source.includes(helperAnchor)) throw new Error('audit.ts helper anchor not found');

const helper = `function normalizeLudisphereShopifyJson(raw: string): string {\n  let parsed: unknown;\n  try {\n    parsed = JSON.parse(raw);\n  } catch {\n    throw new Error("Ludisphere Shopify JSON invalide");\n  }\n\n  const products = (parsed as { products?: unknown }).products;\n  if (!Array.isArray(products)) throw new Error("Ludisphere Shopify JSON sans tableau products");\n\n  const escapeHtml = (value: string): string => value\n    .replaceAll("&", "&amp;")\n    .replaceAll("<", "&lt;")\n    .replaceAll(">", "&gt;")\n    .replaceAll('\\"', "&quot;")\n    .replaceAll("'", "&#039;");\n\n  const cards = products.map((item) => {\n    const product = item as {\n      title?: unknown;\n      handle?: unknown;\n      variants?: Array<{ price?: unknown; available?: unknown }>;\n      images?: Array<{ src?: unknown }>;\n    };\n    const title = typeof product.title === "string" ? product.title.trim() : "";\n    const handle = typeof product.handle === "string" ? product.handle.trim() : "";\n    if (!title || !handle) return "";\n\n    const variants = Array.isArray(product.variants) ? product.variants : [];\n    const available = variants.some((variant) => variant.available === true);\n    const prices = variants\n      .map((variant) => typeof variant.price === "string" || typeof variant.price === "number" ? Number(variant.price) : Number.NaN)\n      .filter((price) => Number.isFinite(price))\n      .sort((a, b) => a - b);\n    const price = prices.length ? \\`\\${prices[0].toFixed(2).replace(".", ",")} €\\` : "";\n    const image = Array.isArray(product.images) && typeof product.images[0]?.src === "string" ? product.images[0].src : "";\n    const url = \\`https://ludisphere.fr/products/\\${encodeURIComponent(handle)}\\`;\n    const stock = available ? "En stock Disponible Ajouter au panier" : "Rupture de stock Produit épuisé";\n    return \\`<article><h2><a href="\\${escapeHtml(url)}">\\${escapeHtml(title)}</a></h2>\\${image ? \\<img src="\\${escapeHtml(image)}" alt="\\${escapeHtml(title)}">\\ : ""}<p>One Piece Card Game Français FR \\${stock} \\${escapeHtml(price)}</p></article>\\`;\n  }).join("");\n\n  return \\`<!doctype html><html lang="fr"><head><title>Ludisphere One Piece Shopify feed</title></head><body><h1>One Piece Card Game Ludisphere</h1>\\${cards}</body></html>\\`;\n}\n\n`;

source = source.replace(helperAnchor, helper + helperAnchor);

const oldFetchBlock = `    const html = new TextDecoder("utf-8").decode(body);\n    validateSemanticResponse(html, connector);\n    const extracted = extractCandidates(html, response.url || sourceUrl, connector);`;
const newFetchBlock = `    let html = new TextDecoder("utf-8").decode(body);\n    const contentType = response.headers.get("content-type") ?? "";\n    if (connector.key === "ludisphere" && /application\\/json/i.test(contentType)) {\n      html = normalizeLudisphereShopifyJson(html);\n    }\n    validateSemanticResponse(html, connector);\n    const extracted = extractCandidates(html, response.url || sourceUrl, connector);`;

if (!source.includes(oldFetchBlock)) throw new Error('audit.ts fetch block not found');
source = source.replace(oldFetchBlock, newFetchBlock);

fs.writeFileSync(path, source);
console.log('Installed Ludisphere Shopify JSON normalization in src/audit.ts');
