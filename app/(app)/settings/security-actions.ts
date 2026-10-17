"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toDataURL } from "qrcode";
import { ActionError, factorAction } from "@/lib/safe-action";
import {
  beginEnrolment,
  disableTwoFactor,
  regenerateBackupCodes,
  twoFactorState,
  verifyCode,
} from "@/lib/two-factor";
import { isLockedOut, recordAttempt } from "@/lib/auth-attempts";

const codeSchema = z.object({
  code: z.string().min(1, "enterCode").max(32).trim(),
});

/**
 * Starts enrolment and returns what the user needs to add the account.
 *
 * The secret is stored immediately but stays unconfirmed, so an enrolment that
 * is abandoned halfway cannot lock anyone out — `twoFactorState` only reports
 * `enabled` once a code has actually been proved.
 */
export const startEnrolment = factorAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const { secret, uri } = await beginEnrolment(ctx.user.id, ctx.user.email);
    // Rendered server-side to a data URI: the QR never travels as a URL that
    // could be logged, and no client-side QR library ships to the browser.
    const qr = await toDataURL(uri, { margin: 1, width: 240 });

    return { secret, qr };
  });

/** Confirms enrolment with a real code, then issues the backup codes. */
export const confirmEnrolment = factorAction
  .inputSchema(codeSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await verifyCode(ctx.user.id, parsedInput.code, {
      confirmEnrolment: true,
    });

    await recordAttempt({
      email: ctx.user.email,
      userId: ctx.user.id,
      stage: "totp",
      outcome: result === "ok" ? "success" : "failure",
    });

    if (result === "not-enrolled") throw new ActionError("notEnrolled");
    if (result !== "ok") throw new ActionError("invalidCode");

    const codes = await regenerateBackupCodes(ctx.user.id);
    revalidatePath("/", "layout");
    return { codes };
  });

/**
 * Turning the factor off requires a current code.
 *
 * Otherwise anyone who reaches an already-verified session — a borrowed laptop
 * left open — could strip the protection without holding the phone.
 */
export const turnOffTwoFactor = factorAction
  .inputSchema(codeSchema)
  .action(async ({ parsedInput, ctx }) => {
    if (await isLockedOut(ctx.user.email, "totp")) {
      throw new ActionError("tooManyAttempts");
    }

    const result = await verifyCode(ctx.user.id, parsedInput.code);
    await recordAttempt({
      email: ctx.user.email,
      userId: ctx.user.id,
      stage: "totp",
      outcome: result === "ok" ? "success" : "failure",
    });

    if (result !== "ok") throw new ActionError("invalidCode");

    await disableTwoFactor(ctx.user.id);
    revalidatePath("/", "layout");
    return { ok: true as const };
  });

export const newBackupCodes = factorAction
  .inputSchema(codeSchema)
  .action(async ({ parsedInput, ctx }) => {
    const state = await twoFactorState(ctx.user.id);
    if (!state.enabled) throw new ActionError("notEnrolled");

    const result = await verifyCode(ctx.user.id, parsedInput.code);
    await recordAttempt({
      email: ctx.user.email,
      userId: ctx.user.id,
      stage: "totp",
      outcome: result === "ok" ? "success" : "failure",
    });

    if (result !== "ok") throw new ActionError("invalidCode");

    const codes = await regenerateBackupCodes(ctx.user.id);
    revalidatePath("/", "layout");
    return { codes };
  });
