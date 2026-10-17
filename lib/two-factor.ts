import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { backupCodes, sessions, users } from "@/db/schema";
import { seal, unseal } from "@/lib/secret-box";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";

export const BACKUP_CODE_COUNT = 10;

/**
 * The raw session token from the cookie.
 *
 * `auth()` returns the session's contents but not its key, and marking a single
 * session as having passed the second factor needs the key. Reading the cookie
 * is safe here because the value is only ever used to look up a row that must
 * also match the authenticated user.
 */
export async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get("__Secure-authjs.session-token")?.value ??
    jar.get("authjs.session-token")?.value ??
    null
  );
}

export interface TwoFactorState {
  /** The user has an authenticator enrolled and confirmed. */
  readonly enabled: boolean;
  /** Enrolment started but never proved with a code. */
  readonly pending: boolean;
  /** This session has satisfied the factor. */
  readonly verified: boolean;
  readonly backupCodesLeft: number;
}

export const twoFactorState = cache(
  async (userId: string): Promise<TwoFactorState> => {
    const token = await currentSessionToken();

    const [row] = await db
      .select({
        secret: users.totpSecret,
        confirmedAt: users.totpConfirmedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const enabled = row?.confirmedAt != null && row.secret !== null;
    const pending = row?.secret !== null && row?.confirmedAt == null;

    if (!enabled) {
      return { enabled: false, pending, verified: false, backupCodesLeft: 0 };
    }

    const [session] =
      token === null
        ? []
        : await db
            .select({ verifiedAt: sessions.totpVerifiedAt })
            .from(sessions)
            .where(
              and(
                eq(sessions.sessionToken, token),
                eq(sessions.userId, userId),
              ),
            )
            .limit(1);

    const remaining = await db
      .select({ id: backupCodes.id })
      .from(backupCodes)
      .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

    return {
      enabled: true,
      pending: false,
      verified: session?.verifiedAt != null,
      backupCodesLeft: remaining.length,
    };
  },
);

/** Marks the *current* session as having satisfied the second factor. */
async function markSessionVerified(userId: string): Promise<void> {
  const token = await currentSessionToken();
  if (token === null) return;

  await db
    .update(sessions)
    .set({ totpVerifiedAt: new Date() })
    .where(and(eq(sessions.sessionToken, token), eq(sessions.userId, userId)));
}

/** Begins enrolment: a secret is stored but stays unconfirmed until proved. */
export async function beginEnrolment(
  userId: string,
  email: string,
): Promise<{ secret: string; uri: string }> {
  const secret = generateTotpSecret();

  await db
    .update(users)
    .set({
      totpSecret: seal(secret),
      totpConfirmedAt: null,
      totpLastStep: null,
    })
    .where(eq(users.id, userId));

  return { secret, uri: totpUri(secret, email, "Ledger") };
}

export type VerifyResult = "ok" | "invalid" | "not-enrolled";

/**
 * Checks a code and, on success, records the step it used so the same code
 * cannot be presented again.
 */
export async function verifyCode(
  userId: string,
  code: string,
  options: { confirmEnrolment?: boolean } = {},
): Promise<VerifyResult> {
  const [row] = await db
    .select({
      secret: users.totpSecret,
      lastStep: users.totpLastStep,
      confirmedAt: users.totpConfirmedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.secret) return "not-enrolled";

  const secret = unseal(row.secret);
  // Unsealing fails if AUTH_SECRET changed. Treating that as "not enrolled"
  // rather than crashing lets the user re-enrol instead of being locked out
  // with a 500.
  if (secret === null) return "not-enrolled";

  const result = verifyTotp(secret, code, Date.now(), row.lastStep);
  if (!result.ok) return "invalid";

  await db
    .update(users)
    .set({
      totpLastStep: result.step,
      ...(options.confirmEnrolment === true
        ? { totpConfirmedAt: new Date() }
        : {}),
    })
    .where(eq(users.id, userId));

  await markSessionVerified(userId);
  return "ok";
}

/**
 * Backup codes.
 *
 * Hashed with a plain SHA-256 rather than a slow KDF: these are 50 bits of
 * generated randomness, not chosen passwords, so brute force is not the threat
 * a slow hash defends against.
 */
const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hashBackupCode(code: string): string {
  return createHash("sha256")
    .update(code.toUpperCase().replace(/[\s-]/g, ""))
    .digest("hex");
}

export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  await db.delete(backupCodes).where(eq(backupCodes.userId, userId));

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = Array.from(
      randomBytes(10),
      (byte) => BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length] ?? "A",
    ).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  await db.insert(backupCodes).values(
    codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })),
  );

  return codes;
}

export async function useBackupCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const candidate = hashBackupCode(code);

  const rows = await db
    .select({ id: backupCodes.id, hash: backupCodes.codeHash })
    .from(backupCodes)
    .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

  const match = rows.find((row) => {
    const a = Buffer.from(row.hash);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (!match) return false;

  // Marked used rather than deleted, so the audit trail shows it was spent.
  await db
    .update(backupCodes)
    .set({ usedAt: new Date() })
    .where(eq(backupCodes.id, match.id));

  await markSessionVerified(userId);
  return true;
}

export async function disableTwoFactor(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: null, totpConfirmedAt: null, totpLastStep: null })
    .where(eq(users.id, userId));

  await db.delete(backupCodes).where(eq(backupCodes.userId, userId));

  // Every session loses its verified mark, so re-enabling cannot inherit trust
  // from a session that was verified under the old secret.
  await db
    .update(sessions)
    .set({ totpVerifiedAt: null })
    .where(eq(sessions.userId, userId));
}
