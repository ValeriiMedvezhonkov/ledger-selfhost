"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, factorAction } from "@/lib/safe-action";
import { useBackupCode, verifyCode } from "@/lib/two-factor";
import { isLockedOut, recordAttempt } from "@/lib/auth-attempts";
import { cookies } from "next/headers";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import { issueRefreshToken, revokeToken } from "@/lib/refresh-tokens";
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECURE,
  REFRESH_MAX_AGE_SECONDS,
} from "@/lib/session-config";

const codeSchema = z.object({
  code: z.string().min(1, "enterCode").max(32).trim(),
});

/**
 * Satisfies the second factor for the current session.
 *
 * Accepts either an authenticator code or a backup code, because asking the
 * user to pick which kind they are holding adds a decision and no security.
 * Every outcome is recorded with its address, and repeated failures lock the
 * address out for a while.
 */
export const submitFactorCode = factorAction
  .inputSchema(codeSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { email } = ctx.user;

    if (await isLockedOut(email, "totp")) {
      await recordAttempt({
        email,
        userId: ctx.user.id,
        stage: "totp",
        outcome: "locked",
      });
      throw new ActionError("tooManyAttempts");
    }

    const code = parsedInput.code.trim();
    // A backup code carries a separator and letters; an authenticator code is
    // six digits. Checked in that order so a mistyped backup code does not
    // burn a TOTP step.
    const looksLikeBackup = /[^0-9]/.test(code);

    const ok = looksLikeBackup
      ? await useBackupCode(ctx.user.id, code)
      : (await verifyCode(ctx.user.id, code)) === "ok";

    await recordAttempt({
      email,
      userId: ctx.user.id,
      stage: looksLikeBackup ? "backup" : "totp",
      outcome: ok ? "success" : "failure",
    });

    if (!ok) throw new ActionError("invalidCode");

    /*
     * Re-issue the renewal credential now marked verified, so a session minted
     * silently later starts out verified too. Without this the factor would be
     * demanded again on every renewal, which is the sort of friction that gets
     * a security feature switched off.
     */
    const jar = await cookies();
    const secure = await secureCookiesEnabled();
    const cookieName = secure ? REFRESH_COOKIE_SECURE : REFRESH_COOKIE;
    const existing = jar.get(cookieName)?.value;
    if (existing !== undefined) await revokeToken(existing);

    const refresh = await issueRefreshToken({
      userId: ctx.user.id,
      totpVerified: true,
    });
    jar.set(cookieName, refresh, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: REFRESH_MAX_AGE_SECONDS,
    });

    revalidatePath("/", "layout");
    redirect("/");
  });
