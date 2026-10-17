import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { refreshTokens, sessions } from "@/db/schema";
import {
  REFRESH_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-config";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a refresh token, optionally continuing an existing family.
 *
 * Returns the raw value, which is the only time it exists in plaintext — the
 * row keeps a hash, so a database leak yields nothing replayable.
 */
export async function issueRefreshToken(options: {
  readonly userId: string;
  readonly totpVerified: boolean;
  readonly family?: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await db.insert(refreshTokens).values({
    userId: options.userId,
    family: options.family ?? randomUUID(),
    tokenHash: hashToken(token),
    totpVerified: options.totpVerified,
    expiresAt: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000),
  });

  return token;
}

export type RefreshResult =
  | {
      readonly ok: true;
      readonly sessionToken: string;
      readonly refreshToken: string;
      readonly userId: string;
    }
  | { readonly ok: false; readonly reason: "unknown" | "expired" | "reused" };

/**
 * Exchanges a refresh token for a new session and a replacement token.
 *
 * Rotation is what makes a long-lived credential tolerable, and reuse detection
 * is what rotation buys. A token that has already been spent should never be
 * presented again — the browser that used it holds the replacement — so seeing
 * one means a copy is circulating, and the whole family goes.
 */
export async function redeemRefreshToken(
  token: string,
): Promise<RefreshResult> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown" };

  if (row.revokedAt !== null) return { ok: false, reason: "reused" };

  if (row.usedAt !== null) {
    // Someone is replaying a spent token. Burn the family: every descendant is
    // suspect, and so is every session opened from it.
    await revokeFamily(row.family);
    return { ok: false, reason: "reused" };
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  await db
    .update(refreshTokens)
    .set({ usedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));

  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId: row.userId,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    // Carried forward, so renewal neither downgrades a verified session nor
    // re-prompts someone who already proved the factor for this browser.
    totpVerifiedAt: row.totpVerified ? new Date() : null,
  });

  const refreshToken = await issueRefreshToken({
    userId: row.userId,
    totpVerified: row.totpVerified,
    family: row.family,
  });

  return { ok: true, sessionToken, refreshToken, userId: row.userId };
}

/** Revokes every token in a family, and every session it opened. */
export async function revokeFamily(family: string): Promise<void> {
  const rows = await db
    .select({ userId: refreshTokens.userId })
    .from(refreshTokens)
    .where(eq(refreshTokens.family, family))
    .limit(1);

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.family, family), isNull(refreshTokens.revokedAt)));

  const userId = rows[0]?.userId;
  if (userId === undefined) return;

  // The sessions cannot be traced to the family individually, so the safe move
  // on suspected theft is to end all of that user's sessions and make both the
  // thief and the owner sign in again.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Used on sign-out: this browser's family only. */
export async function revokeToken(token: string): Promise<void> {
  const [row] = await db
    .select({ family: refreshTokens.family })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return;

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.family, row.family), isNull(refreshTokens.revokedAt)));
}
