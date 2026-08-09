import { describe, expect, it } from "vitest";
import { isTransientPreviewStatus } from "../src/previewHttp";

describe("politique de reprise de la Preview", () => {
  it("reprend seulement les statuts transitoires", () => {
    expect([401, 429, 500, 502, 503].every(isTransientPreviewStatus)).toBe(true);
    expect([200, 400, 403, 404, 422].some(isTransientPreviewStatus)).toBe(false);
  });
});
