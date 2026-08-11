import { afterEach, describe, expect, it, vi } from "vitest";
import { auditConnector } from "../src/audit";
import { oupi } from "../src/connectors/oupi";

const connector = {
  ...oupi,
  sources: ["https://oupi.eu/fr/382-one-piece"],
  followDiscoveredProductPages: false
};

const okHtml = "<!doctype html><html><head><title>One Piece</title></head><body>One Piece Card Game</body></html>";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Oupi transient retry", () => {
  it("réessaie une seule fois un HTTP 5xx puis accepte le succès", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("temporaire", { status: 503 }))
      .mockResolvedValueOnce(new Response(okHtml, { status: 200, headers: { "content-type": "text/html" } }));
    const promise = auditConnector(connector);
    await vi.advanceTimersByTimeAsync(1_500);
    const audit = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.sources[0].error).toBeUndefined();
    expect(audit.sources[0].status).toBe(200);
  });

  it("réessaie une seule fois une erreur réseau transitoire", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(new Response(okHtml, { status: 200, headers: { "content-type": "text/html" } }));
    const promise = auditConnector(connector);
    await vi.advanceTimersByTimeAsync(1_500);
    const audit = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.sources[0].status).toBe(200);
  });

  it("ne retente jamais un HTTP 403", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const audit = await auditConnector(connector);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.sources[0].status).toBe(403);
    expect(audit.sources[0].error).toBe("HTTP 403");
  });

  it("borne les 5xx à deux tentatives maximum", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("temporaire", { status: 503 })));
    const promise = auditConnector(connector);
    await vi.advanceTimersByTimeAsync(1_500);
    const audit = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.sources[0].status).toBe(503);
    expect(audit.sources[0].error).toBe("HTTP 503");
  });
});
