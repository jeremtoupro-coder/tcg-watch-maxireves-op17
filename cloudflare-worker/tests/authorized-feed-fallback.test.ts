import { afterEach, describe, expect, it, vi } from "vitest";
import { auditStore } from "../src/storeAudit";
import type { ConnectorDefinition, Env } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

const connector: ConnectorDefinition = {
  key: "bcd-jeux",
  name: "BCD Jeux",
  sources: ["https://www.bcd-jeux.fr/produit-op17.html"],
  productUrlPatterns: [/produit-op17\.html/i],
  responseMustContainAny: [/one[\s-]*piece/i],
  authorizedFeedEnv: "AUTHORIZED_FEED_BCD_JEUX_URL",
  notes: []
};

const env = {
  AUTHORIZED_FEED_BCD_JEUX_URL: "https://secret-feed.test/token-123.csv"
} as unknown as Env;

describe("fallback des flux partenaires", () => {
  it("ne martèle pas le fallback public pendant le Fast Watch minute", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("feed unavailable", { status: 503 });
    }));

    const audit = await auditStore(connector, env, [], { allowPublicFallback: false });
    expect(calls).toHaveLength(1);
    expect(audit.sourceKind).toBe("authorized_feed");
    expect(audit.runtimeStatus).toBe("degraded");
    expect(JSON.stringify(audit)).not.toContain("token-123");
  });

  it("autorise un seul fallback public pendant la Discovery et trace la panne du feed", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("secret-feed.test")) return new Response("feed unavailable", { status: 503 });
      return new Response(`
        <html><head><title>One Piece Card Game</title></head><body>
          <h1>Display OP17 Français</h1><p>En stock — 119,90 €</p>
        </body></html>
      `, { status: 200 });
    }));

    const audit = await auditStore(connector, env, [], { allowPublicFallback: true });
    expect(calls).toHaveLength(2);
    expect(audit.sourceKind).toBe("public_html");
    expect(audit.runtimeStatus).toBe("healthy");
    expect(audit.warnings?.join(" ")).toMatch(/HTTP 503/i);
    expect(JSON.stringify(audit)).not.toContain("token-123");
  });
});
