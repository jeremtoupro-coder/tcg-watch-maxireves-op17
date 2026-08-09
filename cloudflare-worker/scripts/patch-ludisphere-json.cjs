const fs = require('fs');
const path = 'src/audit.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('function normalizeLudisphereShopifyJson(')) {
  console.log('Ludisphere JSON parser already installed.');
} else {
  const helperAnchor = 'function buildRequestHeaders(connector: ConnectorDefinition): Record<string, string> {';
  if (!source.includes(helperAnchor)) throw new Error('audit.ts helper anchor not found');

  const helper = [
    'function normalizeLudisphereShopifyJson(raw: string): string {',
    '  let parsed: unknown;',
    '  try { parsed = JSON.parse(raw); } catch { throw new Error("Ludisphere Shopify JSON invalide"); }',
    '  const products = (parsed as { products?: unknown }).products;',
    '  if (!Array.isArray(products)) throw new Error("Ludisphere Shopify JSON sans tableau products");',
    '  const escapeHtml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\\\"", "&quot;").replaceAll("\'", "&#039;");',
    '  const cards = products.map((item) => {',
    '    const product = item as { title?: unknown; handle?: unknown; variants?: Array<{ price?: unknown; available?: unknown }>; images?: Array<{ src?: unknown }> };',
    '    const title = typeof product.title === "string" ? product.title.trim() : "";',
    '    const handle = typeof product.handle === "string" ? product.handle.trim() : "";',
    '    if (!title || !handle) return "";',
    '    const variants = Array.isArray(product.variants) ? product.variants : [];',
    '    const available = variants.some((variant) => variant.available === true);',
    '    const prices = variants.map((variant) => typeof variant.price === "string" || typeof variant.price === "number" ? Number(variant.price) : Number.NaN).filter((price) => Number.isFinite(price)).sort((a, b) => a - b);',
    '    const price = prices.length ? prices[0].toFixed(2).replace(".", ",") + " €" : "";',
    '    const image = Array.isArray(product.images) && typeof product.images[0]?.src === "string" ? product.images[0].src : "";',
    '    const url = "https://ludisphere.fr/products/" + encodeURIComponent(handle);',
    '    const stock = available ? "En stock Disponible Ajouter au panier" : "Rupture de stock Produit épuisé";',
    '    return "<article><h2><a href=\\\"" + escapeHtml(url) + "\\\">" + escapeHtml(title) + "</a></h2>" + (image ? "<img src=\\\"" + escapeHtml(image) + "\\\" alt=\\\"" + escapeHtml(title) + "\\\">" : "") + "<p>One Piece Card Game Français FR " + stock + " " + escapeHtml(price) + "</p></article>";',
    '  }).join("");',
    '  return "<!doctype html><html lang=\\\"fr\\\"><head><title>Ludisphere One Piece Shopify feed</title></head><body><h1>One Piece Card Game Ludisphere</h1>" + cards + "</body></html>";',
    '}',
    '',
    ''
  ].join('\n');

  source = source.replace(helperAnchor, helper + helperAnchor);

  const oldFetchBlock = [
    '    const html = new TextDecoder("utf-8").decode(body);',
    '    validateSemanticResponse(html, connector);',
    '    const extracted = extractCandidates(html, response.url || sourceUrl, connector);'
  ].join('\n');
  const newFetchBlock = [
    '    let html = new TextDecoder("utf-8").decode(body);',
    '    const contentType = response.headers.get("content-type") ?? "";',
    '    if (connector.key === "ludisphere" && /application\\/json/i.test(contentType)) { html = normalizeLudisphereShopifyJson(html); }',
    '    validateSemanticResponse(html, connector);',
    '    const extracted = extractCandidates(html, response.url || sourceUrl, connector);'
  ].join('\n');
  if (!source.includes(oldFetchBlock)) throw new Error('audit.ts fetch block not found');
  source = source.replace(oldFetchBlock, newFetchBlock);
}

const rolloutPath = 'src/connectors/rollout.ts';
let rollout = fs.readFileSync(rolloutPath, 'utf8');
rollout = rollout.replace('https://ludisphere.fr/collections/one-piece-card-game-precommande', 'https://020d06-2.myshopify.com/collections/one-piece-card-game-precommande/products.json?limit=250');
fs.writeFileSync(path, source);
fs.writeFileSync(rolloutPath, rollout);
console.log('Installed Ludisphere canonical Shopify JSON source + parser.');
