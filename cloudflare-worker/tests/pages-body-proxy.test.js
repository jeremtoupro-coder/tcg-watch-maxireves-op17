import { afterEach, describe, expect, it, vi } from "vitest";
import pagesWorker from "../public-site/_worker.js";

afterEach(() => vi.unstubAllGlobals());

describe("proxy JSON cockpit Pages", () => {
  it("bufferise le petit corps une seule fois avant le transfert", async () => {
    let forwardedBody;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      forwardedBody = init.body;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));
    const request = new Request("https://op-watch-tcg-fr.pages.dev/cockpit/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "secret" })
    });

    const response = await pagesWorker.fetch(request, {});
    expect(response.status).toBe(200);
    expect(request.bodyUsed).toBe(true);
    expect(forwardedBody).toBeInstanceOf(ArrayBuffer);
    expect(JSON.parse(new TextDecoder().decode(forwardedBody))).toMatchObject({ email: "owner@example.test" });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("refuse un corps déclaré au-dessus de 64 Kio sans contacter l'upstream", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const request = new Request("https://op-watch-tcg-fr.pages.dev/cockpit/api/control", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "70000" },
      body: "{}"
    });
    const response = await pagesWorker.fetch(request, {});
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
});
