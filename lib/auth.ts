import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { REFRESH_COOKIE, REFRESH_COOKIE_SECURE } from "@/lib/session-config";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { households, users } from "@/db/schema";
import { isAllowedEmail } from "@/lib/env";
import { twoFactorState } from "@/lib/two-factor";
import { getAppLockState } from "@/lib/app-lock";

/**
 * The authenticated principal every server component and action works from.
 * `householdId` is non-nullable here: code downstream should never have to ask
 * whether the current user belongs to a household.
 */
export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly color: string;
  readonly householdId: string;
  readonly baseCurrency: string;
}

/**
 * Resolve the session and re-check the allowlist against the *current* env, so
 * revoking access takes effect on the next request rather than whenever the
 * session happens to expire. Cached per-request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const email = session?.user.email;

  if (!session || !email || !isAllowedEmail(email)) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      displayName: users.displayName,
      image: users.image,
      color: users.color,
      householdId: users.householdId,
      baseCurrency: households.baseCurrency,
    })
    .from(users)
    .leftJoin(households, eq(users.householdId, households.id))
    .where(eq(users.id, session.user.id))
    .limit(1);

  const row = rows[0];
  if (!row?.householdId || !row.baseCurrency) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.displayName ?? row.name ?? row.email,
    image: row.image,
    color: row.color,
    householdId: row.householdId,
    baseCurrency: row.baseCurrency,
  };
});

/**
 * Every server component and Server Action calls this. Proxy-level protection
 * is a convenience for redirects, never the security boundary.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // `redirect` is declared to return never, which narrows `user` below; an
  // async helper doing the redirect itself would not.
  if (!user) redirect(await renewalTarget());

  /*
   * The second factor is enforced here, alongside the allowlist, because this
   * is the one function every page and Server Action already goes through.
   * Putting it in proxy.ts instead would make it a routing convenience that a
   * direct request could sidestep.
   */
  const factor = await twoFactorState(user.id);
  if (factor.enabled && !factor.verified) redirect("/verify");

  return user;
}

/**
 * Sends an unauthenticated request to renew rather than to the login page,
 * when the browser holds a renewal credential.
 *
 * The proxy cannot do this alone: it only sees that a session *cookie* exists,
 * not whether the row behind it still does. An expired session therefore
 * arrives here with its cookie intact, and this is the last point that can turn
 * a visible logout into an invisible renewal.
 */
async function renewalTarget(): Promise<string> {
  const jar = await cookies();
  const hasRefresh = jar.has(REFRESH_COOKIE) || jar.has(REFRESH_COOKIE_SECURE);

  if (!hasRefresh) return "/login";

  const path = (await headers()).get("x-ledger-path") ?? "/";
  return "/api/session/refresh?next=" + encodeURIComponent(path);
}

/**
 * For route handlers: the user, but only once the second factor is satisfied.
 *
 * Route handlers do not go through `requireUser`, so they were reachable by a
 * session that had authenticated but never verified — which meant the export
 * endpoints would hand over the whole ledger while the UI was still showing the
 * verification screen. A second factor that only guards the pages is decorative.
 */
export async function getVerifiedUser(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const factor = await twoFactorState(user.id);
  if (factor.enabled && !factor.verified) return null;

  // The same argument holds for the app lock: a locked phone must not be able
  // to download the ledger through an export link.
  const lock = await getAppLockState();
  if (lock.enabled && lock.locked) return null;

  return user;
}

/**
 * The current user without the second-factor gate.
 *
 * Only for the verification page itself, which by definition runs before the
 * factor is satisfied and would otherwise redirect to itself forever.
 */
export async function requireUserPendingFactor(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Thrown by actions rather than redirecting, so the client gets an error. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("notSignedIn");
    this.name = "NotAuthenticatedError";
  }
}

export async function requireUserForAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new NotAuthenticatedError();

  /*
   * Gating the actions matters more than gating the pages. A page redirect only
   * stops someone reading the UI; without this, a session that never satisfied
   * the second factor could still call any mutating action directly and write
   * to the ledger.
   */
  const factor = await twoFactorState(user.id);
  if (factor.enabled && !factor.verified) throw new TwoFactorRequiredError();

  return user;
}

/** Thrown when a session is authenticated but has not satisfied the factor. */
export class TwoFactorRequiredError extends Error {
  constructor() {
    super("twoFactorRequired");
    this.name = "TwoFactorRequiredError";
  }
}

/**
 * For the actions that *satisfy* the second factor — verifying a code, using a
 * backup code, enrolling. They necessarily run before it is satisfied, so they
 * cannot go through the gate above.
 */
export async function requireUserForFactorAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}
