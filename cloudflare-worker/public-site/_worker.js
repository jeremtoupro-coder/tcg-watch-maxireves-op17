const PRODUCTION_API = "https://tcg-watch-one-piece.jeremie-touitou-pro.workers.dev";

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
      const upstream = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
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
    const contentType = asset.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return asset;

    const html = await asset.text();
    const headers = new Headers(asset.headers);
    headers.delete("content-length");
    return new Response(
      html.replace("</body>", '<script src="/catalog.js" defer></script></body>'),
      { status: asset.status, statusText: asset.statusText, headers }
    );
  }
};
