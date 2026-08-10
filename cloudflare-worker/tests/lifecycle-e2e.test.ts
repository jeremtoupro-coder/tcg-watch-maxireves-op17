import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateCandidates } from "../src/engine";
import { aliasesForProduct, buildActiveWatchConfig, type OfficialProduct } from "../src/opwatchV1";
import { MemoryStateStore } from "../src/state";
import type { ProductCandidate } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

const OP17: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER OP-17",
  releaseDate: "2026-08-28",
  aliases: aliasesForProduct("OP-17")
};
const config = buildActiveWatchConfig([OP17]);

function candidate(
  availability: ProductCandidate["availability"],
  priceText?: string
): ProductCandidate {
  return {
    store: "oupi",
    storeName: "Oupi",
    title: "Display OP-17 Français",
    url: "https://oupi.test/produit/display-op17-fr.html",
    sourceUrl: "https://oupi.test/produit/display-op17-fr.html",
    matchedReferences: ["OP-17"],
    format: "display",
    identityKey: "oupi|OP-17|display|fr|sku-17-display",
    externalId: "sku-17-display",
    availability,
    language: "Français confirmé",
    priceText,
    imageUrl: "https://img.test/op17.jpg",
    commercialEligible: true,
    excerpt: `${availability} ${priceText ?? ""}`
  };
}

const liveEnv = {
  WRITE_STATE: "true",
  DISCORD_MODE: "live" as const,
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/test-token"
};

describe("cycle commercial end-to-end", () => {
  it("fait baseline → précommande → prix → rupture → retour sans spam", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const run = (current: ProductCandidate, now: string) => evaluateCandidates(
      [current],
      liveEnv,
      { config, stateStore, baselineStores: ["oupi"], now, claimSettleMs: 0 }
    );

    const baseline = await run(candidate("unavailable"), "2026-08-09T10:00:00.000Z");
    expect(baseline.alertMatches).toHaveLength(0);
    expect(baseline.state.writes).toBe(1);

    const preorder = await run(candidate("preorder", "129,90 €"), "2026-08-09T10:01:00.000Z");
    expect(preorder.changes.map((change) => change.type)).toContain("preorder_opened");
    expect(preorder.discordDispatch.sent).toBe(1);

    const samePreorder = await run(candidate("preorder", "129,90 €"), "2026-08-09T10:02:00.000Z");
    expect(samePreorder.changes).toHaveLength(0);
    expect(samePreorder.state.writes).toBe(0);

    const priceDrop = await run(candidate("preorder", "119,90 €"), "2026-08-09T10:03:00.000Z");
    expect(priceDrop.changes.map((change) => change.type)).toEqual(["price_drop"]);
    expect(priceDrop.discordDispatch.sent).toBe(1);

    const unavailable = await run(candidate("unavailable"), "2026-08-09T10:04:00.000Z");
    expect(unavailable.changes.map((change) => change.type)).toEqual(["became_unavailable"]);
    expect(unavailable.discordDispatch.sent).toBe(1);

    const sameUnavailable = await run(candidate("unavailable"), "2026-08-09T10:05:00.000Z");
    expect(sameUnavailable.changes).toHaveLength(0);

    const restock = await run(candidate("available", "119,90 €"), "2026-08-09T10:06:00.000Z");
    expect(restock.changes.map((change) => change.type)).toEqual(["back_in_stock"]);
    expect(restock.discordDispatch.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const fields = Object.fromEntries(
      restock.discordPayloads[0].embeds[0].fields.map((field) => [field.name, field.value])
    );
    expect(fields).toMatchObject({
      "🏷️ Référence": "OP-17",
      "🧩 Format": "Display / booster box",
      "💰 Prix": "119,90 €",
      "🏪 Boutique": "Oupi",
      "📦 Disponibilité": "En stock",
      "🇫🇷 Langue": "Français confirmé"
    });
    expect(fields["🕒 Détecté"]).toBeTruthy();
    expect(fields["🔗 Offre"]).toContain("https://oupi.test/produit/display-op17-fr.html");
    expect(restock.discordPayloads[0].embeds[0].thumbnail?.url).toBe("https://img.test/op17.jpg");
  });

  it("ne valide pas l'état si Discord échoue puis retente la même transition", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const responses = [500, 204];
    const fetchMock = vi.fn(async () => new Response(null, { status: responses.shift() ?? 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await evaluateCandidates([candidate("unavailable")], liveEnv, {
      config,
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-08-09T11:00:00.000Z",
      claimSettleMs: 0
    });

    const failed = await evaluateCandidates([candidate("available", "119,90 €")], liveEnv, {
      config,
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-08-09T11:01:00.000Z",
      claimSettleMs: 0
    });
    expect(failed.discordDispatch.sent).toBe(0);
    expect(failed.discordDispatch.errors).toEqual(["Discord HTTP 500"]);
    expect(failed.state.writes).toBe(0);

    const retried = await evaluateCandidates([candidate("available", "119,90 €")], liveEnv, {
      config,
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-08-09T11:02:00.000Z",
      claimSettleMs: 0
    });
    expect(retried.changes.map((change) => change.type)).toContain("back_in_stock");
    expect(retried.discordDispatch.sent).toBe(1);
    expect(retried.state.writes).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regroupe stock et prix simultanés en une seule alerte", async () => {
    const stateStore = new MemoryStateStore({ writable: true });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await evaluateCandidates([candidate("unavailable", "139,90 €")], liveEnv, {
      config,
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-08-09T12:00:00.000Z",
      claimSettleMs: 0
    });
    const transition = await evaluateCandidates([candidate("available", "119,90 €")], liveEnv, {
      config,
      stateStore,
      baselineStores: ["oupi"],
      now: "2026-08-09T12:01:00.000Z",
      claimSettleMs: 0
    });

    expect(transition.changes.map((change) => change.type)).toEqual(["back_in_stock", "price_drop"]);
    expect(transition.alertMatches).toHaveLength(1);
    expect(transition.alertMatches[0].change.type).toBe("back_in_stock");
    expect(transition.discordDispatch.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
