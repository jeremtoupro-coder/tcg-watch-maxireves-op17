import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareApiStateStore } from "../src/cloudflareApiState";
import type { ProductSnapshot } from "../src/types";

const credentials = {
  accountId: "account",
  apiToken: "token",
  namespaceTitle: "tcg-watch-state"
};

function snapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    key: "product:oupi:abc",
    store: "oupi",
    storeName: "Oupi",
    title: "OP-17 Booster Box (French)",
    url: "https://oupi.example/op17.html",
    matchedReferences: ["OP17"],
    availability: "unavailable",
    language: "Français confirmé",
    priceText: undefined,
    priceCents: undefined,
    firstSeenAt: "2026-06-28T00:00:00.000Z",
    lastSeenAt: "2026-06-28T00:00:00.000Z",
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("budget d'écritures Cloudflare KV", () => {
  it("n'écrit pas un snapshot inchangé à chaque passage", async () => {
    const values = new Map<string, string>([
      ["product:oupi:abc", JSON.stringify(snapshot())]
    ]);
    let puts = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.split("/values/")[1]);

      if ((init?.method ?? "GET") === "PUT") {
        puts += 1;
        values.set(key, String(init?.body ?? ""));
        return new Response(null, { status: 200 });
      }

      const value = values.get(key);
      return value === undefined
        ? new Response(null, { status: 404 })
        : new Response(value, { status: 200 });
    }));

    const store = new CloudflareApiStateStore(credentials, "namespace");

    await store.put("product:oupi:abc", snapshot({
      lastSeenAt: "2026-06-28T00:05:00.000Z"
    }));
    expect(puts).toBe(0);

    await store.put("product:oupi:abc", snapshot({
      availability: "preorder",
      lastSeenAt: "2026-06-28T00:10:00.000Z"
    }));
    expect(puts).toBe(1);
  });

  it("limite le heartbeat de succès à une écriture par heure", async () => {
    const key = "metadata:external-monitor:last-success";
    const values = new Map<string, string>([[key, "2026-06-28T00:00:00.000Z"]]);
    let puts = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const requestKey = decodeURIComponent(url.pathname.split("/values/")[1]);

      if ((init?.method ?? "GET") === "PUT") {
        puts += 1;
        values.set(requestKey, String(init?.body ?? ""));
        return new Response(null, { status: 200 });
      }

      const value = values.get(requestKey);
      return value === undefined
        ? new Response(null, { status: 404 })
        : new Response(value, { status: 200 });
    }));

    const store = new CloudflareApiStateStore(credentials, "namespace");

    await store.putMetadata("external-monitor:last-success", "2026-06-28T00:05:00.000Z");
    expect(puts).toBe(0);

    await store.putMetadata("external-monitor:last-success", "2026-06-28T01:00:00.000Z");
    expect(puts).toBe(1);
  });
});
