import { afterEach, describe, expect, it, vi } from "vitest";
import { auditAuthorizedFeed, parseAuthorizedFeed } from "../src/authorizedFeed";
import { MemoryStateStore } from "../src/state";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function connector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    key: "playin",
    name: "Playin",
    sources: [],
    productUrlPatterns: [/./],
    notes: [],
    ...overrides
  };
}

function chunkedResponse(chunks: string[], contentType: string): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  }), { status: 200, headers: { "content-type": contentType } });
}

describe("flux produits autorisés", () => {
  it("parse un CSV personnalisable", () => {
    const rows = parseAuthorizedFeed(`title;url;price;stock;language\nOne Piece OP17 Display FR;https://shop.test/op17;119,90;disponible;français`, "text/csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toMatch(/OP17/);
  });

  it("parse JSON et XML", () => {
    expect(parseAuthorizedFeed(JSON.stringify({ products: [{ title: "OP17 Booster", url: "https://x.test/op17" }] }), "application/json")).toHaveLength(1);
    expect(parseAuthorizedFeed(`<products><product><title>OP17 Booster</title><url>https://x.test/op17</url></product></products>`, "application/xml")).toHaveLength(1);
  });

  it("parse aussi un TSV avec champs usuels", () => {
    const rows = parseAuthorizedFeed(
      "name\tproduct_url\tsale_price\tin_stock\tlang\tean\nDisplay OP17 FR\thttps://shop.test/op17\t119.90\ttrue\tfr\t1234567890123",
      "text/tab-separated-values"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Display OP17 FR", ean: "1234567890123" });
  });

  it("interprète une quantité de stock numérique positive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,https://shop.test/op17,119.90,12,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(audit.candidates[0].availability).toBe("available");
  });

  it("parcourt un catalogue généraliste supérieur à 5 Mo sans le matérialiser", async () => {
    const irrelevant = "Autre jeu,https://shop.test/autre,19.90,disponible,français\n".repeat(82_000);
    const csv = [
      "title,url,price,stock,language",
      irrelevant,
      "One Piece OP17 Display FR,https://shop.test/op17,119.90,disponible,français"
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue.csv");

    expect(audit.sources[0].responseBytes).toBeGreaterThan(5_000_000);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].matchedReferences).toContain("OP-17");
  });

  it("parcourt les objets d'un gros flux JSON sans partager un Response consommable", async () => {
    const json = JSON.stringify({
      products: [
        { title: "Autre jeu", url: "https://shop.test/autre" },
        { title: "One Piece EB05 Booster FR", url: "https://shop.test/eb05", stock: "12", language: "français" }
      ]
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(json, {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue.json");

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].matchedReferences).toContain("EB-05");
  });

  it("conserve les enregistrements CSV cités lorsque les chunks coupent guillemets et CRLF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chunkedResponse([
      "title,url,description,stock,language\r",
      "\n\"One Piece OP17 Display FR\",https://shop.test/op17,\"Texte avec un \"",
      "\"drop\"\" réel\",disponible,français\r",
      "\n"
    ], "text/csv")));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/chunked.csv");

    expect(audit.sources[0].error).toBeUndefined();
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      availability: "available",
      language: "Français confirmé"
    });
  });

  it("tolère un guillemet littéral isolé sans fusionner tout le catalogue CSV", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chunkedResponse([
      '"title","url","description","stock","language"\n',
      '"One Piece OP17 Display FR","https://shop.test/op17","Boîte 7" collector française","disponible","français"\n',
      '"Autre jeu","https://shop.test/autre","Produit standard","disponible","français"\n'
    ], "text/csv")));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue-imparfait.csv");

    expect(audit.sources[0].error).toBeUndefined();
    expect(audit.sources[0].productLinksSeen).toBe(2);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].matchedReferences).toContain("OP-17");
  });

  it("conserve un objet JSON lorsque une chaîne et une accolade traversent les chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chunkedResponse([
      '{"products":[{"title":"One Piece EB',
      '05 Booster FR","url":"https://shop.test/eb05","description":"précom',
      'mande française","stock":"disponible","language":"français"}',
      "]}"
    ], "application/json")));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/chunked.json");

    expect(audit.sources[0].error).toBeUndefined();
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].matchedReferences).toContain("EB-05");
  });

  it("refuse avant lecture un catalogue au-dessus de la borne de transfert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url\nOne Piece OP17,https://shop.test/op17",
      { status: 200, headers: { "content-type": "text/csv", "content-length": "40000001" } }
    )));

    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue.csv");

    expect(audit.candidates).toEqual([]);
    expect(audit.sources[0].error).toMatch(/40000001 octets/);
  });

  it("revalide un gros flux avec ETag sans retélécharger ni reparcourir le catalogue", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const csv = [
      "title,url,price,stock,language",
      "One Piece OP17 Display FR,https://shop.test/op17,119.90,disponible,français"
    ].join("\n");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get("if-none-match") === '"catalog-v1"') {
        return new Response(null, { status: 304, headers: { etag: '"catalog-v1"' } });
      }
      return new Response(csv, {
        status: 200,
        headers: { "content-type": "text/csv", etag: '"catalog-v1"' }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await auditAuthorizedFeed(
      connector(),
      "https://feed.example/catalogue.csv?secret=token",
      { stateStore }
    );
    const second = await auditAuthorizedFeed(
      connector(),
      "https://feed.example/catalogue.csv?secret=token",
      { stateStore }
    );
    const discoveryRefresh = await auditAuthorizedFeed(
      connector(),
      "https://feed.example/catalogue.csv?secret=token",
      { stateStore, forceRefresh: true }
    );

    expect(first.candidates).toHaveLength(1);
    expect(first.sources[0]).toMatchObject({ status: 200, cacheValidation: "etag" });
    expect(second.candidates).toEqual([]);
    expect(second.sources[0]).toMatchObject({
      status: 304,
      notModified: true,
      responseBytes: 0,
      cacheValidation: "etag"
    });
    expect(discoveryRefresh.candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("if-none-match")).toBeNull();
    expect(JSON.stringify(second)).not.toContain("secret=token");
  });

  it("ne retélécharge pas à la minute un catalogue complet sans validateur HTTP", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const csv = "title,url,price,stock,language\nOne Piece OP17 Display FR,https://shop.test/op17,119.90,disponible,français";
    const fetchMock = vi.fn(async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue.csv", {
      stateStore,
      forceRefresh: true
    });
    const fast = await auditAuthorizedFeed(connector(), "https://feed.example/catalogue.csv", { stateStore });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.candidates).toHaveLength(1);
    expect(fast.candidates).toEqual([]);
    expect(fast.sources[0]).toMatchObject({
      cacheValidation: "none",
      deferred: true,
      responseBytes: 0
    });
    expect(fast.notes.join(" ")).toMatch(/reporté à la Discovery/i);
  });

  it("n'envoie jamais le validateur d'un ancien URL de feed vers un nouveau feed", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const seenHeaders: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers));
      return new Response(
        "title,url,stock,language\nOne Piece OP17 FR,https://shop.test/op17,1,français",
        { status: 200, headers: { "content-type": "text/csv", etag: '"v1"' } }
      );
    }));

    await auditAuthorizedFeed(connector(), "https://feed.example/first.csv", { stateStore });
    await auditAuthorizedFeed(connector(), "https://feed.example/second.csv", { stateStore });

    expect(seenHeaders[0].get("if-none-match")).toBeNull();
    expect(seenHeaders[1].get("if-none-match")).toBeNull();
  });

  it("convertit un flux en candidat FR sans exposer l'URL secrète", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,image_url\nOne Piece OP17 Display FR,https://shop.test/op17,119.90,en stock,français,https://img.test/op17.jpg`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector(), "https://secret-feed.test/token-123.csv");
    expect(audit.sources[0].sourceUrl).toBe("authorized-feed:playin");
    expect(JSON.stringify(audit)).not.toContain("token-123");
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({
      language: "Français confirmé",
      availability: "available",
      commercialEligible: true
    });
  });

  it("reste fail-closed pour une marketplace sans vendeur officiel confirmé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://fnac.test/op17,149.90,disponible,français,Vendeur Tiers`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector({
      key: "fnac",
      name: "Fnac",
      requiredSellerPatterns: [/\bfnac\b/i],
      requiredSellerLabel: "Fnac"
    }), "https://secret-feed.test/fnac.csv");

    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0].commercialEligible).toBe(false);
    expect(audit.candidates[0].commercialEligibilityReason).toMatch(/Fnac non confirmé/i);
  });

  it("accepte la marketplace lorsque le vendeur officiel est explicitement présent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`title,url,price,stock,language,seller\nOne Piece OP17 Display FR,https://fnac.test/op17,149.90,disponible,français,Fnac`, {
      status: 200,
      headers: { "content-type": "text/csv" }
    })));

    const audit = await auditAuthorizedFeed(connector({
      key: "fnac",
      name: "Fnac",
      requiredSellerPatterns: [/\bfnac\b/i],
      requiredSellerLabel: "Fnac"
    }), "https://secret-feed.test/fnac.csv");

    expect(audit.candidates[0].commercialEligible).toBe(true);
  });

  it("refuse un flux secret non chiffré avant toute requête", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const audit = await auditAuthorizedFeed(connector(), "http://feed.example/playin.csv");
    expect(audit.sources[0].error).toMatch(/HTTPS/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignore une ligne dont le lien produit n'est pas HTTP(S)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,javascript:alert(1),119.90,en stock,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const audit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(audit.candidates).toEqual([]);
  });

  it("refuse les destinations locales et les liens produits non chiffrés", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const privateAudit = await auditAuthorizedFeed(connector(), "https://127.0.0.1/feed.csv");
    expect(privateAudit.sources[0].error).toMatch(/HTTPS/i);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "title,url,price,stock,language\nOne Piece OP17 Display FR,http://shop.test/op17,119.90,en stock,français",
      { status: 200, headers: { "content-type": "text/csv" } }
    )));
    const productAudit = await auditAuthorizedFeed(connector(), "https://feed.example/playin.csv");
    expect(productAudit.candidates).toEqual([]);
  });

  it("ne répercute jamais une URL secrète contenue dans une erreur réseau", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connexion refusée vers https://secret-feed.test/token-123.csv");
    }));
    const audit = await auditAuthorizedFeed(connector(), "https://secret-feed.test/token-123.csv");
    expect(audit.sources[0].error).toBe("Flux autorisé: échec réseau sans détail sensible");
    expect(JSON.stringify(audit)).not.toContain("token-123");
  });
});
