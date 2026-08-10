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

    return env.ASSETS.fetch(request);
  }
};
