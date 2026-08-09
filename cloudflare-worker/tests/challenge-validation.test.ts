import { afterEach, describe, expect, it, vi } from "vitest";
import { auditConnector } from "../src/audit";
import type { ConnectorDefinition } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function connector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    key: "test-shop",
    name: "Test Shop",
    sources: ["https://shop.test/one-piece"],
    productUrlPatterns: [/\/produit\//i],
    responseMustContainAny: [/one[\s-]*piece/i],
    notes: [],
    ...overrides
  };
}

describe("validation sémantique des sources", () => {
  it("rejette un challenge Cloudflare même lorsqu'il répond HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>Just a moment...</title></head>
      <body>One Piece OP17 <script src="/cdn-cgi/challenge-platform/h/g/orchestrate"></script></body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector());
    expect(audit.sources[0].status).toBeUndefined();
    expect(audit.sources[0].error).toMatch(/Challenge\/anti-bot: Cloudflare challenge/i);
    expect(audit.candidates).toEqual([]);
  });

  it("rejette une page DataDome/CAPTCHA qui contient artificiellement le nom du produit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>Fnac.com</title></head><body>
      One Piece OP16
      <script>var dd={host:'geo.captcha-delivery.com',url:'/captcha/'}</script>
      </body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector());
    expect(audit.sources[0].error).toMatch(/DataDome CAPTCHA/i);
  });

  it("rejette un Robot Check Amazon même en HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>Amazon Robot Check</title></head><body>
      One Piece OP17. Sorry, we just need to make sure you're not a robot.
      <form action="/errors/validateCaptcha"></form>
      </body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector());
    expect(audit.sources[0].error).toMatch(/Amazon robot\/CAPTCHA/i);
  });

  it("ne confond pas un vrai gros document avec un challenge uniquement parce qu'un bundle mentionne captcha", async () => {
    const legitimate = `<html><head><title>One Piece OP17</title></head><body><h1>One Piece OP17</h1>${"Produit disponible. ".repeat(8000)}<script>const feature='captcha';</script></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(legitimate, { status: 200 })));

    const audit = await auditConnector(connector());
    expect(audit.sources[0].error).toBeUndefined();
    expect(audit.sources[0].status).toBe(200);
  });

  it("rejette un HTTP 200 sans le marqueur métier attendu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><head><title>Accueil générique</title></head><body>Figurines et vêtements</body></html>
    `, { status: 200 })));

    const audit = await auditConnector(connector());
    expect(audit.sources[0].error).toMatch(/contenu métier attendu absent/i);
  });
});
