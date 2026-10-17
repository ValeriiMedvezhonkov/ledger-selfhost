import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { authAttempts } from "@/db/schema";
import {
  LOCKOUT_WINDOW_MINUTES,
  MAX_FAILURES,
} from "@/lib/lockout-config";

export type AuthStage = "signin" | "totp" | "backup" | "refresh";
export type AuthOutcome = "success" | "failure" | "locked";

/**
 * The client address, read from the proxy headers a host sets.
 *
 * `x-forwarded-for` is a chain — client, then each proxy that appended itself.
 * The *first* entry is the client, but it is also the only part the client can
 * forge, so this is trustworthy exactly to the extent that the deployment
 * terminates at a proxy which overwrites it. Behind Vercel or Cloudflare it is;
 * on a raw origin exposed to the internet it is not, and the value is a hint
 * rather than evidence.
 */
export async function clientIp(): Promise<string | null> {
  const list = await headers();

  const forwarded = list.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }

  // Platform-specific headers, which a proxy sets itself and a client cannot
  // append to.
  return (
    list.get("cf-connecting-ip") ??
    list.get("x-real-ip") ??
    list.get("x-vercel-forwarded-for")
  );
}

export async function clientUserAgent(): Promise<string | null> {
  const value = (await headers()).get("user-agent");
  // Truncated: a user agent is attacker-controlled free text, and there is no
  // reason to store kilobytes of it.
  return value === null ? null : value.slice(0, 400);
}

export interface RecordAttempt {
  readonly email: string | null;
  readonly userId?: string | null;
  readonly stage: AuthStage;
  readonly outcome: AuthOutcome;
}

/**
 * Writes one row per attempt. Never throws: an audit write failing must not be
 * able to block a legitimate sign-in, and the error is more useful in the log
 * than as a 500 on the login page.
 */
export async function recordAttempt(attempt: RecordAttempt): Promise<void> {
  try {
    const [ip, userAgent] = await Promise.all([clientIp(), clientUserAgent()]);
    await db.insert(authAttempts).values({
      email: attempt.email?.toLowerCase() ?? null,
      userId: attempt.userId ?? null,
      stage: attempt.stage,
      outcome: attempt.outcome,
      ip,
      userAgent,
    });
  } catch (error) {
    console.error("[auth-attempt] could not record", error);
  }
}

// Shared with the unlock script, which cannot import this server-only module.
export { MAX_FAILURES, LOCKOUT_WINDOW_MINUTES } from "@/lib/lockout-config";

/**
 * Whether this email has failed too often recently.
 *
 * Counted per email rather than per IP: an attacker can rotate addresses far
 * more easily than they can guess which mailbox to target, and there are
 * exactly two valid ones here. The cost is that someone who knows an address
 * can lock it out — acceptable for a two-person ledger, and visible in the
 * attempt log when it happens.
 */
export async function isLockedOut(
  email: string,
  stage: AuthStage,
): Promise<boolean> {
  const address = email.toLowerCase();
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000);

  /*
   * Failures are counted from the last success, not from a counter that gets
   * reset. Deleting rows to "clear" the count would throw away the audit trail
   * this table exists for — the failed attempts and their addresses are the
   * part worth keeping.
   */
  const [lastSuccess] = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.email, address),
        eq(authAttempts.stage, stage),
        eq(authAttempts.outcome, "success"),
      ),
    )
    .orderBy(desc(authAttempts.createdAt))
    .limit(1);

  const floor =
    lastSuccess !== undefined && lastSuccess.at > since ? lastSuccess.at : since;

  const [row] = await db
    .select({ failures: sql<string>`count(*)` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.email, address),
        eq(authAttempts.stage, stage),
        eq(authAttempts.outcome, "failure"),
        gte(authAttempts.createdAt, floor),
      ),
    );

  return Number(row?.failures ?? 0) >= MAX_FAILURES;
}

export interface AttemptRow {
  readonly id: string;
  readonly email: string | null;
  readonly stage: string;
  readonly outcome: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

export async function listRecentAttempts(limit = 50): Promise<AttemptRow[]> {
  return db
    .select({
      id: authAttempts.id,
      email: authAttempts.email,
      stage: authAttempts.stage,
      outcome: authAttempts.outcome,
      ip: authAttempts.ip,
      userAgent: authAttempts.userAgent,
      createdAt: authAttempts.createdAt,
    })
    .from(authAttempts)
    .orderBy(desc(authAttempts.createdAt))
    .limit(limit);
}
