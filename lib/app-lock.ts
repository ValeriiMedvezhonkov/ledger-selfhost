import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/db";
import { sessions, users, webauthnCredentials } from "@/db/schema";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import { env } from "@/lib/env";
import { currentSessionToken } from "@/lib/two-factor";

/**
 * The Face ID app lock.
 *
 * A passkey on the phone, checked by the server, per session. "Per session" is
 * the point: a lock the client enforces is a screen that a stale tab or a
 * direct request walks straight past. Here `session.app_unlocked_at` is null
 * while locked, and every mutating action refuses to run until a passkey
 * assertion sets it (see `authAction` in lib/safe-action.ts).
 *
 * The client clears it on a cold start and after inactivity (`lockApp`), which
 * is the iOS behaviour being copied: the app is locked whenever you come back
 * to it, not on a timer the server would have to guess.
 */

export interface AppLockState {
  /** The user has turned the lock on (and holds at least one passkey). */
  readonly enabled: boolean;
  /** This session has not presented a passkey since it was last locked. */
  readonly locked: boolean;
}

const OPEN: AppLockState = { enabled: false, locked: false };

/**
 * The lock state of the *current* session, cached per request.
 *
 * Read straight from the session row rather than through `auth()`, for the
 * same reason as the second factor: the flag lives on the row, and the cookie
 * is the only handle on it. An unknown or expired token reads as "no lock" —
 * the caller's own authentication check is what turns that away.
 */
export const getAppLockState = cache(async (): Promise<AppLockState> => {
  const token = await currentSessionToken();
  if (token === null) return OPEN;

  const [row] = await db
    .select({
      enabled: users.appLockEnabled,
      unlockedAt: sessions.appUnlockedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, new Date())))
    .limit(1);

  if (!row?.enabled) return OPEN;
  return { enabled: true, locked: row.unlockedAt === null };
});

// --- relying party ----------------------------------------------------------

export interface RelyingParty {
  readonly rpID: string;
  readonly origins: readonly string[];
}

/**
 * Who the passkeys are for. AUTH_URL decides when it is set — it is already
 * the app's canonical address for Auth.js — otherwise the request's own host,
 * which is what a proxy-fronted deployment without it would see anyway.
 *
 * In development the LAN hosts from DEV_ORIGINS are accepted as origins too,
 * so a phone opening the dev server is not refused outright. (WebAuthn itself
 * still requires a secure context and a domain-shaped RP ID, so a bare LAN IP
 * over http will not get as far as calling this.)
 */
export async function relyingParty(): Promise<RelyingParty> {
  let origin: string;
  if (env.AUTH_URL !== undefined) {
    origin = new URL(env.AUTH_URL).origin;
  } else {
    const list = await headers();
    const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
    const proto =
      list.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      ((await secureCookiesEnabled()) ? "https" : "http");
    origin = `${proto}://${host}`;
  }

  const origins = new Set([origin]);
  if (env.NODE_ENV === "development") {
    for (const host of env.DEV_ORIGINS.split(",")) {
      const trimmed = host.trim();
      if (trimmed === "") continue;
      origins.add(`http://${trimmed}:3000`);
      origins.add(`https://${trimmed}:3000`);
    }
  }

  return { rpID: new URL(origin).hostname, origins: [...origins] };
}

// --- challenges -------------------------------------------------------------

export type ChallengePurpose = "register" | "unlock";

const CHALLENGE_TTL_SECONDS = 5 * 60;

async function challengeCookieName(): Promise<string> {
  // __Host- pins it to this origin and path, and requires Secure — only
  // possible where the app is actually served over HTTPS.
  return (await secureCookiesEnabled()) ? "__Host-ledger-webauthn" : "ledger-webauthn";
}

/**
 * HMAC key for challenge cookies, derived from AUTH_SECRET with its own HKDF
 * label so it can never coincide with the TOTP sealing key or anything
 * Auth.js derives from the same secret.
 */
function challengeKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, "", "ledger:webauthn-challenge:v1", 32));
}

function sign(payload: string): string {
  return createHmac("sha256", challengeKey()).update(payload).digest("base64url");
}

interface ChallengePayload {
  readonly p: ChallengePurpose;
  readonly u: string;
  readonly c: string;
  readonly e: number;
}

/**
 * Stores the challenge in a short-lived, signed, httpOnly cookie rather than
 * in the database: it lives five minutes, belongs to one browser, and a table
 * of half-finished ceremonies would need sweeping. Signed, not encrypted — the
 * challenge is not a secret, it only has to come back unaltered and bound to
 * this user and purpose.
 */
export async function issueChallenge(
  purpose: ChallengePurpose,
  userId: string,
  challenge: string,
): Promise<void> {
  const payload: ChallengePayload = {
    p: purpose,
    u: userId,
    c: challenge,
    e: Date.now() + CHALLENGE_TTL_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const jar = await cookies();
  jar.set(await challengeCookieName(), `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: await secureCookiesEnabled(),
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

function isChallengePayload(value: unknown): value is ChallengePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.p === "register" || record.p === "unlock") &&
    typeof record.u === "string" &&
    typeof record.c === "string" &&
    typeof record.e === "number"
  );
}

/**
 * The challenge issued to this user for this purpose, or null. Single use:
 * the cookie is cleared whether or not it checks out, so a captured response
 * cannot be replayed against the same challenge.
 */
export async function consumeChallenge(
  purpose: ChallengePurpose,
  userId: string,
): Promise<string | null> {
  const jar = await cookies();
  const name = await challengeCookieName();
  const raw = jar.get(name)?.value;
  jar.delete(name);
  if (raw === undefined) return null;

  const [body, mac] = raw.split(".");
  if (body === undefined || mac === undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isChallengePayload(parsed)) return null;
  if (parsed.p !== purpose || parsed.u !== userId || parsed.e < Date.now()) {
    return null;
  }
  return parsed.c;
}

// --- session + credentials --------------------------------------------------

/** Sets or clears this session's unlock mark. */
export async function setSessionUnlocked(
  userId: string,
  unlocked: boolean,
): Promise<void> {
  const token = await currentSessionToken();
  if (token === null) return;

  await db
    .update(sessions)
    .set({ appUnlockedAt: unlocked ? new Date() : null })
    .where(and(eq(sessions.sessionToken, token), eq(sessions.userId, userId)));
}

export async function listCredentials(userId: string) {
  return db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
}

/** "iPhone", "Mac" — a label for the settings list, guessed from the UA. */
export async function guessDeviceLabel(): Promise<string | null> {
  const ua = (await headers()).get("user-agent") ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  return null;
}

// --- response shape guards ----------------------------------------------------

/*
 * Server Action inputs arrive as untyped JSON. These check the outer shape so a
 * malformed body fails as validation rather than deep inside the verifier;
 * @simplewebauthn/server then verifies everything that actually matters —
 * signatures, challenge, origin, RP ID hash.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCredentialEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 1024 &&
    typeof value.rawId === "string" &&
    value.type === "public-key" &&
    isRecord(value.clientExtensionResults) &&
    isRecord(value.response) &&
    typeof value.response.clientDataJSON === "string"
  );
}

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponseJSON {
  return (
    hasCredentialEnvelope(value) &&
    isRecord(value.response) &&
    typeof value.response.attestationObject === "string"
  );
}

export function isAuthenticationResponse(
  value: unknown,
): value is AuthenticationResponseJSON {
  return (
    hasCredentialEnvelope(value) &&
    isRecord(value.response) &&
    typeof value.response.authenticatorData === "string" &&
    typeof value.response.signature === "string"
  );
}
