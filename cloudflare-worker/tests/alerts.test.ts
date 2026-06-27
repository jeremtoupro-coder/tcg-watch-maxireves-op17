import { describe, expect, it } from "vitest";
import { evaluateAlertRules } from "../src/alerts";
import { WATCH_CONFIG } from "../src/config";
import { buildDiscordPayloads, dispatchDiscordPayloads } from "../src/discord";
import { MemoryStateStore, processCandidates } from "../src/state";
import type { ProductCandidate } from "../src/types";

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    store: "oupi",
    storeName: "Oupi",
    title: "Display OP-17 FR",
    url: "https://oupi.eu/produit/op-17-fr.html",
    sourceUrl: "https://oupi.eu/en/413-pre-order-one-piece",
    matchedReferences: ["OP17"],
    availability: "unavailable",
    language: "Français confirmé",
    priceText: "119,76 €",
    excerpt: "Display OP-17 FR",
    ...overrides
  };
}

describe("règles d'alerte", () => {
  it("n'alerte pas pendant la création silencieuse de la base", async () => {
    const result = await processCandidates([candidate()], new MemoryStateStore(), {
      writeState: false,
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(evaluateAlertRules(result.changes, WATCH_CONFIG)).toEqual([]);
  });

  it("déclenche l'alerte française sur un retour en stock", async () => {
    const store = new MemoryStateStore();
    await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    const result = await processCandidates([
      candidate({ availability: "available" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:05:00.000Z"
    });

    const matches = evaluateAlertRules(result.changes, WATCH_CONFIG);
    expect(matches).toHaveLength(1);
    expect(matches[0].rule.id).toBe("target-products-available-fr");
  });

  it("écarte la version anglaise de l'alerte de disponibilité FR", async () => {
    const store = new MemoryStateStore();
    await processCandidates([
      candidate({ language: "Anglais détecté" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    const result = await processCandidates([
      candidate({ language: "Anglais détecté", availability: "available" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:05:00.000Z"
    });

    expect(evaluateAlertRules(result.changes, WATCH_CONFIG)).toEqual([]);
  });

  it("génère un aperçu Discord sans envoi réseau", async () => {
    const store = new MemoryStateStore();
    await processCandidates([candidate()], store, {
      writeState: true,
      now: "2026-06-27T10:00:00.000Z"
    });

    const result = await processCandidates([
      candidate({ availability: "available" })
    ], store, {
      writeState: true,
      now: "2026-06-27T10:05:00.000Z"
    });

    const payloads = buildDiscordPayloads(evaluateAlertRules(result.changes, WATCH_CONFIG));
    const dispatch = await dispatchDiscordPayloads(payloads, {
      AUDIT_MODE: "true",
      DISCORD_MODE: "dry-run",
      WRITE_STATE: "false"
    });

    expect(payloads[0].embeds[0].title).toContain("Retour en stock");
    expect(dispatch).toEqual({
      mode: "dry-run",
      attempted: 1,
      sent: 0,
      errors: []
    });
  });
});
