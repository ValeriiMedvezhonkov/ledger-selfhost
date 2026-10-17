"use server";

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { actionClient, ActionError } from "@/lib/safe-action";
import { isLockedOut, recordAttempt } from "@/lib/auth-attempts";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { isAllowedEmail } from "@/lib/env";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import {
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-config";

const signInSchema = z.object({
  email: z.email("enterEmail").max(200),
  password: z.string().min(1, "enterPassword").max(200),
});

/**
 * Signs in with an address and a password.
 *
 * Every failure — unknown address, no password set, wrong password — answers
 * the same way and takes roughly as long, because the difference between them
 * is exactly what tells an attacker which addresses are worth attacking.
 */
export const signInWithPassword = actionClient
  .inputSchema(signInSchema)
  .action(async ({ parsedInput }) => {
    const email = parsedInput.email.trim().toLowerCase();

    if (await isLockedOut(email, "signin")) {
      await recordAttempt({ email, stage: "signin", outcome: "locked" });
      throw new ActionError("tooManyAttempts");
    }

    const rows = isAllowedEmail(email)
      ? await db
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      : [];
    // `.at` rather than destructuring: it types the miss as undefined, which
    // the checks below depend on.
    const user = rows.at(0);

    /*
     * Verify against a decoy when there is no account or no password set.
     *
     * Returning early would answer in a millisecond while a real address takes
     * a tenth of a second, and that difference is measurable over the network —
     * it would turn the login form into a way to enumerate the allowlist.
     */
    const stored = user?.passwordHash ?? null;
    const matched = await verifyPassword(parsedInput.password, stored ?? DECOY_HASH);
    const ok = matched && stored !== null;

    await recordAttempt({
      email,
      userId: ok ? (user?.id ?? null) : null,
      stage: "signin",
      outcome: ok ? "success" : "failure",
    });

    if (!ok || user === undefined) throw new ActionError("wrongCredentials");

    // Cost parameters can be raised over time; a correct sign-in is the only
    // moment the plaintext exists to re-hash with the current ones.
    if (needsRehash(stored)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(parsedInput.password) })
        .where(eq(users.id, user.id));
    }

    const sessionToken = randomUUID();
    await db.insert(sessions).values({
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      // A password sign-in is a stronger proof than the app lock, so the new
      // session starts unlocked — otherwise a device without the passkey (a
      // laptop, a new phone) could sign in and still never get past the lock.
      appUnlockedAt: new Date(),
    });

    const secure = await secureCookiesEnabled();
    const jar = await cookies();

    // The cookie the Drizzle adapter reads, so the second factor, renewal and
    // the audit log all work unchanged.
    jar.set(
      secure ? "__Secure-authjs.session-token" : "authjs.session-token",
      sessionToken,
      {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      },
    );

    return { ok: true as const };
  });

/**
 * A real hash of a value nobody knows, so the no-account path costs the same as
 * the wrong-password path. Generated once per process rather than stored: its
 * only job is to make scrypt run.
 */
const DECOY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
