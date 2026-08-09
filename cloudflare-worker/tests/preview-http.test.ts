import { describe, expect, it } from "vitest";
import { isTransientPreviewStatus } from "../src/previewHttp";
import { derivePreviewAuditToken } from "../src/previewCredentials";

describe("politique de reprise de la Preview", () => {
  it("reprend seulement les statuts transitoires", () => {
    expect([401, 429, 500, 502, 503].every(isTransientPreviewStatus)).toBe(true);
    expect([200, 400, 403, 404, 422].some(isTransientPreviewStatus)).toBe(false);
  });

  it("dérive un jeton Preview stable et distinct du secret de déploiement", () => {
    const cloudflareToken = "cloudflare-test-token-0123456789";
    const first = derivePreviewAuditToken(cloudflareToken);
    const second = derivePreviewAuditToken(cloudflareToken);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(cloudflareToken);
    expect(derivePreviewAuditToken(`${cloudflareToken}-different`)).not.toBe(first);
  });

  it("refuse de dériver un jeton depuis une valeur absente ou triviale", () => {
    expect(() => derivePreviewAuditToken("court")).toThrow(/absent ou trop court/i);
  });
});
