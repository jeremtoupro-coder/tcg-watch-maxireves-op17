import { afterEach, describe, expect, it, vi } from "vitest";
import runtimeWorker from "../src/runtimeEntry";
import type { Env } from "../src/types";

const env = {
  PRODUCTION_PROBE_MODE: "true",
  PREVIEW_AUDIT_TOKEN: "probe-token"
} as Env;

function request(path: string, token = "probe-token") {
  return runtimeWorker.fetch(new Request(`https://prod.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }), env);
}

afterEach(() => vi.unstubAllGlobals());

describe("sonde marchand privée du Worker production", () => {
  it("refuse un accès sans jeton", async () => {
    const response = await request("/merchant-probe?store=philibert&url=https%3A%2F%2Fwww.philibertnet.com%2Ffr%2Fx%2F123-op17.html", "");
    expect(response.status).toBe(401);
  });

  it("refuse un domaine extérieur même avec authentification", async () => {
    const response = await request("/merchant-probe?store=philibert&url=https%3A%2F%2Fexample.com%2Ffr%2Fx%2F123-op17.html");
    expect(response.status).toBe(400);
  });

  it("teste une fiche autorisée sans exposer son contenu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<html><body>One Piece OP17 Français — À venir : Aout</body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    )));
    const url = encodeURIComponent("https://www.philibertnet.com/fr/one-piece-le-jeu-de-cartes/179735-op17.html");
    const response = await request(`/merchant-probe?store=philibert&url=${url}`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body).toMatchObject({
      store: "philibert",
      status: 200,
      ok: true,
      signals: {
        onePiece: true,
        language: "Français confirmé",
        availability: "preorder"
      }
    });
    expect(JSON.stringify(body)).not.toContain("<html>");
  });
});
