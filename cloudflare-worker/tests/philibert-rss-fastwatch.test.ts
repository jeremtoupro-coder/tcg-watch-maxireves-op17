import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTORS } from "../src/connectors";
import { auditStore } from "../src/storeAudit";
import type { OfficialProduct } from "../src/opwatchV1";

const OP17: OfficialProduct = {
  id: "OP17",
  family: "OP",
  label: "OP17 - The World's Strongest Warriors",
  releaseDate: "2026-08-28",
  aliases: ["OP17", "OP-17", "Les Guerriers les plus puissants au Monde", "The World's Strongest Warriors"]
};

const RSS = `<?xml version="1.0"?><rss><channel>
  <title>Philibert One Piece</title>
  <item>
    <title><![CDATA[One Piece Le Jeu de Cartes - OP17 - Les Guerriers les plus puissants au Monde - Boite de 24 Boosters - 144,95€]]></title>
    <link><![CDATA[https://www.philibertnet.com/fr/one-piece-le-jeu-de-cartes/179735-one-piece-le-jeu-de-cartes-op17-les-guerriers-les-plus-puissants-au-monde-boite-de-24-boosters-2100001380243.html]]></link>
  </item>
  <item>
    <title><![CDATA[One Piece Le Jeu de Cartes - OP16 - Boite de 24 Boosters - 144,95€]]></title>
    <link><![CDATA[https://www.philibertnet.com/fr/one-piece-le-jeu-de-cartes/170000-op16.html]]></link>
  </item>
</channel></rss>`;

const DIRECT = `<!doctype html><html><head><title>OP17 Philibert</title></head><body>
  <h1>One Piece Le Jeu de Cartes - OP17 - Les Guerriers les plus puissants au Monde - Boite de 24 Boosters</h1>
  <section><p>Langue(s) : Français</p><p>À venir : Aout</p><p>144,95 €</p><p>Vendu par Philibert</p></section>
</body></html>`;

afterEach(() => vi.unstubAllGlobals());

describe("Philibert RSS + fiches directes", () => {
  it("utilise le RSS officiel et ne relit que la référence active", async () => {
    const philibert = CONNECTORS.find((connector) => connector.key === "philibert")!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("modules/feeder/rss.php?id_category=15860")) {
        return new Response(RSS, { status: 200, headers: { "content-type": "application/xml; charset=UTF-8" } });
      }
      if (url.includes("179735-") && url.includes("op17")) {
        return new Response(DIRECT, { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } });
      }
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const audit = await auditStore(philibert, {}, [OP17]);

    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.sourceKind).toBe("public_structured_feed");
    expect(audit.sources).toHaveLength(2);
    expect(audit.sources[0].sourceUrl).toContain("rss.php?id_category=15860");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("op16"))).toBe(false);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      store: "philibert",
      matchedReferences: expect.arrayContaining(["OP17"]),
      language: "Français confirmé",
      commercialEligible: true
    });
    expect(audit.candidates[0].availability).not.toBe("unknown");
  });

  it("reste sain si le RSS est valide mais qu'aucune référence active n'y figure", async () => {
    const philibert = CONNECTORS.find((connector) => connector.key === "philibert")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `<?xml version="1.0"?><rss><channel><item><title>One Piece OP16 Display</title><link>https://www.philibertnet.com/fr/one-piece-le-jeu-de-cartes/170000-op16.html</link></item></channel></rss>`,
      { status: 200, headers: { "content-type": "application/xml" } }
    )));

    const audit = await auditStore(philibert, {}, [OP17]);
    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.sources).toHaveLength(1);
    expect(audit.candidates).toEqual([]);
  });

  it("reste fail-closed si une fiche active devient inaccessible", async () => {
    const philibert = CONNECTORS.find((connector) => connector.key === "philibert")!;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rss.php")) return new Response(RSS, { status: 200, headers: { "content-type": "application/xml" } });
      return new Response("Forbidden", { status: 403 });
    }));

    const audit = await auditStore(philibert, {}, [OP17]);
    expect(audit.runtimeStatus).toBe("degraded");
    expect(audit.commercialEligible).toBe(false);
    expect(audit.candidates).toEqual([]);
  });
});
