import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions, walletWebhooks } from "@/db/schema";
import { getCategoryNamer } from "@/lib/category-name";
import { env } from "@/lib/env";
import type { Minor } from "@/lib/money";
import { getDefaultAccount } from "@/lib/queries";
import { getSeededNamer, nameOrNull } from "@/lib/seeded-name";
import { secretHint } from "@/lib/wallet-webhook";

/**
 * The Apple Pay webhook's secrets and bookkeeping.
 *
 * Each household can hold its own secret, rotated from the Apple Pay screen and
 * shown exactly once. WALLET_WEBHOOK_SECRET still works alongside it so a
 * shortcut configured before rotation existed keeps recording until somebody
 * rotates — at which point the household's own secret is the one to use.
 */

const SECRET_BYTES = 32;

/** 32 random bytes, base64url: 43 characters that survive being pasted. */
export function generateWalletSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/**
 * SHA-256, not a slow KDF: the input is 256 bits of randomness, not a chosen
 * password, so there is nothing for a slow hash to defend against.
 */
function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface StoredWalletSecret {
  readonly hash: string;
  readonly hint: string;
}

export function storeableSecret(secret: string): StoredWalletSecret {
  return { hash: hashSecret(secret).toString("hex"), hint: secretHint(secret) };
}

export type WalletAuth =
  | { readonly ok: true; readonly via: "db"; readonly householdId: string }
  | { readonly ok: true; readonly via: "env" }
  | { readonly ok: false; readonly reason: "unconfigured" | "unauthorized" };

/**
 * Which secret, if any, the presented token is.
 *
 * Every stored hash is compared in constant time — there is one household, so
 * scanning is free, and it means no early exit reveals how close a guess got.
 * The env secret is hashed too so both sides of its comparison have the same
 * length whatever was sent.
 */
export async function authenticateWalletToken(
  token: string | null,
): Promise<WalletAuth> {
  const rows = await db
    .select({ householdId: walletWebhooks.householdId, hash: walletWebhooks.secretHash })
    .from(walletWebhooks)
    .where(isNotNull(walletWebhooks.secretHash));

  const envSecret = env.WALLET_WEBHOOK_SECRET;
  if (rows.length === 0 && envSecret === undefined) {
    return { ok: false, reason: "unconfigured" };
  }
  if (token === null) return { ok: false, reason: "unauthorized" };

  const presented = hashSecret(token);

  let matched: string | null = null;
  for (const row of rows) {
    if (row.hash === null) continue;
    if (sameHash(presented, Buffer.from(row.hash, "hex"))) matched = row.householdId;
  }
  if (matched !== null) return { ok: true, via: "db", householdId: matched };

  if (envSecret !== undefined && sameHash(presented, hashSecret(envSecret))) {
    return { ok: true, via: "env" };
  }

  return { ok: false, reason: "unauthorized" };
}

/** Records a recorded tap, so the settings screen can show "last: 2 min ago". */
export async function recordWalletReceipt(
  householdId: string,
  transactionId: string,
  at: Date,
): Promise<void> {
  await db
    .insert(walletWebhooks)
    .values({ householdId, lastReceivedAt: at, lastTransactionId: transactionId })
    .onConflictDoUpdate({
      target: walletWebhooks.householdId,
      set: { lastReceivedAt: at, lastTransactionId: transactionId },
    });
}

/**
 * Records why the last request was refused. Shortcuts shows the response body
 * for a moment and then it is gone; this is what lets the settings screen say
 * what went wrong after the fact.
 */
export async function recordWalletError(
  householdId: string,
  message: string,
  at: Date,
): Promise<void> {
  const trimmed = message.slice(0, 500);
  await db
    .insert(walletWebhooks)
    .values({ householdId, lastError: trimmed, lastErrorAt: at })
    .onConflictDoUpdate({
      target: walletWebhooks.householdId,
      set: { lastError: trimmed, lastErrorAt: at },
    });
}

export interface WalletStatus {
  /** Some secret will be accepted for this household. */
  readonly configured: boolean;
  /** Which one: the household's own, the deployment-wide fallback, or none. */
  readonly secretSource: "db" | "env" | null;
  readonly secretHint: string | null;
  readonly rotatedAt: Date | null;
  readonly lastReceivedAt: Date | null;
  readonly lastError: string | null;
  readonly lastErrorAt: Date | null;
  readonly lastTransaction: {
    readonly id: string;
    readonly merchant: string | null;
    readonly amountMinor: Minor;
    readonly categoryName: string | null;
    readonly occurredAt: Date | null;
    readonly createdAt: Date;
  } | null;
  /** Where a tap lands when the shortcut names no account. */
  readonly defaultAccount: { readonly id: string; readonly name: string } | null;
}

export async function getWalletStatus(householdId: string): Promise<WalletStatus> {
  const [rows, defaultAccount] = await Promise.all([
    db
      .select()
      .from(walletWebhooks)
      .where(eq(walletWebhooks.householdId, householdId))
      .limit(1),
    getDefaultAccount(householdId),
  ]);
  const row = rows[0];

  let lastTransaction: WalletStatus["lastTransaction"] = null;
  if (row?.lastTransactionId != null) {
    const [nameCategory, nameSeeded, found] = await Promise.all([
      getCategoryNamer(),
      getSeededNamer(),
      db
        .select({
          id: transactions.id,
          merchant: transactions.merchant,
          merchantSlug: transactions.merchantSlug,
          amountMinor: transactions.amountMinor,
          categoryName: categories.name,
          categorySlug: categories.slug,
          occurredAt: transactions.occurredAt,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.id, row.lastTransactionId),
          ),
        )
        .limit(1),
    ]);
    const tx = found[0];
    if (tx) {
      lastTransaction = {
        id: tx.id,
        merchant: nameOrNull(nameSeeded, tx.merchantSlug, tx.merchant),
        amountMinor: tx.amountMinor,
        categoryName:
          tx.categoryName === null ? null : nameCategory(tx.categorySlug, tx.categoryName),
        occurredAt: tx.occurredAt,
        createdAt: tx.createdAt,
      };
    }
  }

  const hasOwn = row?.secretHash != null;
  const secretSource = hasOwn
    ? "db"
    : env.WALLET_WEBHOOK_SECRET !== undefined
      ? "env"
      : null;

  return {
    configured: secretSource !== null,
    secretSource,
    secretHint: hasOwn ? (row.secretHint ?? null) : null,
    rotatedAt: row?.rotatedAt ?? null,
    lastReceivedAt: row?.lastReceivedAt ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt ?? null,
    lastTransaction,
    defaultAccount:
      defaultAccount === null ? null : { id: defaultAccount.id, name: defaultAccount.name },
  };
}
