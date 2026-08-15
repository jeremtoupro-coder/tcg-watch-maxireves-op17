const PRODUCTION_API = "https://tcg-watch-one-piece.jeremie-touitou-pro.workers.dev";
const MAX_COCKPIT_BODY_BYTES = 64 * 1024;

export async function bufferedCockpitBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COCKPIT_BODY_BYTES) {
    throw new Response(JSON.stringify({ error: "Corps cockpit trop volumineux." }), {
      status: 413,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
  if (request.bodyUsed) {
    throw new Response(JSON.stringify({ error: "Le corps de la requête cockpit a déjà été consommé." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_COCKPIT_BODY_BYTES) {
    throw new Response(JSON.stringify({ error: "Corps cockpit trop volumineux." }), {
      status: 413,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/calendar") {
      try {
        const upstream = await fetch(
          "https://tcg-watch-one-piece-preview.jeremie-touitou-pro.workers.dev/opwatch/v1/calendar",
          {
            headers: {
              "Accept": "application/json",
              "User-Agent": "OPWatchPublic/1.0"
            },
            cf: { cacheTtl: 300, cacheEverything: true }
          }
        );
        if (!upstream.ok) {
          return Response.json({ error: "Calendrier officiel temporairement indisponible." }, { status: 502 });
        }
        const data = await upstream.json();
        const activeProducts = Array.isArray(data.activeProducts)
          ? data.activeProducts.map((product) => ({
              id: product.id,
              label: product.label,
              releaseDate: product.releaseDate,
              releaseDateSource: product.releaseDateSource,
              watchWindow: product.watchWindow
            }))
          : [];
        return Response.json({
          source: "One Piece Card Game France",
          fetchedAt: data.fetchedAt,
          activeProducts
        }, {
          headers: {
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff"
          }
        });
      } catch {
        return Response.json({ error: "Calendrier officiel temporairement indisponible." }, { status: 502 });
      }
    }

    if (url.pathname.startsWith("/cockpit/api/")) {
      const upstreamUrl = new URL(url.pathname + url.search, PRODUCTION_API);
      const headers = new Headers(request.headers);
      headers.set("origin", "https://op-watch-tcg-fr.pages.dev");
      headers.set("host", new URL(PRODUCTION_API).host);
      headers.delete("content-length");
      let body;
      try {
        body = await bufferedCockpitBody(request);
      } catch (response) {
        if (response instanceof Response) return response;
        throw response;
      }
      const upstream = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body,
        redirect: "manual"
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("cache-control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    }

    const asset = await env.ASSETS.fetch(request);
    const cockpit = url.pathname === "/cockpit/" || url.pathname === "/cockpit/index.html";
    if (!cockpit) return asset;
    const headers = new Headers(asset.headers);
    headers.set("cache-control", "no-store");
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  }
};
