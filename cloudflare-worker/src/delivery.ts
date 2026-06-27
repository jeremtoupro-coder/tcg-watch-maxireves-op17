import { buildDiscordPayload, buildDiscordPayloads, dispatchDiscordPayloads } from "./discord";
import type { StateStore } from "./state";
import type { AlertMatch, DiscordPayload, Env } from "./types";

const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;
const CLAIM_SETTLE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function alertDeliveryFingerprint(match: AlertMatch): string {
  const previous = match.change.previous;
  const current = match.change.current;
  const raw = [
    match.rule.id,
    current.key,
    match.change.type,
    previous?.lastSeenAt ?? "none",
    previous?.availability ?? "none",
    previous?.priceCents ?? "none",
    current.availability,
    current.priceCents ?? "none",
    current.language,
    current.matchedReferences.join(",")
  ].join("|");

  return fnv1a(raw);
}

interface ClaimValue {
  token: string;
  claimedAt: string;
}

function parseClaim(value: string | undefined): ClaimValue | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ClaimValue>;
    if (typeof parsed.token !== "string" || typeof parsed.claimedAt !== "string") {
      return undefined;
    }
    return { token: parsed.token, claimedAt: parsed.claimedAt };
  } catch {
    return undefined;
  }
}

async function ownsStableClaim(
  store: StateStore,
  claimKey: string,
  token: string,
  settleMs: number
): Promise<boolean> {
  await sleep(settleMs);
  const firstRead = parseClaim(await store.getMetadata(claimKey));
  if (firstRead?.token !== token) return false;

  await sleep(settleMs);
  const secondRead = parseClaim(await store.getMetadata(claimKey));
  return secondRead?.token === token;
}

export async function deliverAlertMatches(
  matches: AlertMatch[],
  env: Env,
  store: StateStore,
  options: { claimSettleMs?: number; now?: string } = {}
): Promise<{
  payloads: DiscordPayload[];
  dispatch: {
    mode: "dry-run" | "live";
    attempted: number;
    sent: number;
    errors: string[];
  };
  dedupe: {
    checked: number;
    suppressedByReceipt: number;
    suppressedByClaim: number;
    receiptsWritten: number;
  };
}> {
  const mode = env.DISCORD_MODE ?? "dry-run";
  const payloads = buildDiscordPayloads(matches);

  if (mode === "dry-run") {
    return {
      payloads,
      dispatch: await dispatchDiscordPayloads(payloads, env),
      dedupe: {
        checked: matches.length,
        suppressedByReceipt: 0,
        suppressedByClaim: 0,
        receiptsWritten: 0
      }
    };
  }

  if (!store.writable) {
    return {
      payloads,
      dispatch: {
        mode,
        attempted: matches.length,
        sent: 0,
        errors: [
          "Envoi live refusé : la mémoire persistante doit être accessible en écriture pour garantir l'anti-doublon."
        ]
      },
      dedupe: {
        checked: matches.length,
        suppressedByReceipt: 0,
        suppressedByClaim: 0,
        receiptsWritten: 0
      }
    };
  }

  const dispatch = {
    mode,
    attempted: matches.length,
    sent: 0,
    errors: [] as string[]
  };
  const dedupe = {
    checked: matches.length,
    suppressedByReceipt: 0,
    suppressedByClaim: 0,
    receiptsWritten: 0
  };

  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const settleMs = options.claimSettleMs ?? CLAIM_SETTLE_MS;

  for (const match of matches) {
    const fingerprint = alertDeliveryFingerprint(match);
    const receiptKey = `delivery-receipt:${fingerprint}`;
    const claimKey = `delivery-claim:${fingerprint}`;

    if (await store.getMetadata(receiptKey)) {
      dedupe.suppressedByReceipt += 1;
      continue;
    }

    const existingClaim = parseClaim(await store.getMetadata(claimKey));
    if (existingClaim) {
      const claimedAtMs = Date.parse(existingClaim.claimedAt);
      if (Number.isFinite(claimedAtMs) && nowMs - claimedAtMs < CLAIM_STALE_AFTER_MS) {
        dedupe.suppressedByClaim += 1;
        continue;
      }
    }

    const token = crypto.randomUUID();
    await store.putMetadata(claimKey, JSON.stringify({ token, claimedAt: now }));

    if (!(await ownsStableClaim(store, claimKey, token, settleMs))) {
      dedupe.suppressedByClaim += 1;
      continue;
    }

    const payload = buildDiscordPayload(match);
    const result = await dispatchDiscordPayloads([payload], env);
    dispatch.sent += result.sent;
    dispatch.errors.push(...result.errors);

    if (result.sent === 1) {
      await store.putMetadata(
        receiptKey,
        JSON.stringify({ deliveredAt: new Date().toISOString(), token })
      );
      dedupe.receiptsWritten += 1;
    }
  }

  return { payloads, dispatch, dedupe };
}
