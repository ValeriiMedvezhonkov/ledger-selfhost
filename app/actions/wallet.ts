"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, walletWebhooks } from "@/db/schema";
import { authAction } from "@/lib/safe-action";
import { getDefaultAccount } from "@/lib/queries";
import {
  generateWalletSecret,
  getWalletStatus,
  storeableSecret,
} from "@/lib/wallet";

/**
 * Issues a new webhook secret for the household and returns it — the only
 * time it is ever readable. Only the hash is stored, so a lost secret is
 * replaced, never recovered. The previous household secret stops working at
 * once; WALLET_WEBHOOK_SECRET, if set, keeps working as before.
 */
export const rotateWalletSecret = authAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const secret = generateWalletSecret();
    const { hash, hint } = storeableSecret(secret);
    const now = new Date();

    await db
      .insert(walletWebhooks)
      .values({
        householdId: ctx.user.householdId,
        secretHash: hash,
        secretHint: hint,
        rotatedAt: now,
      })
      .onConflictDoUpdate({
        target: walletWebhooks.householdId,
        set: { secretHash: hash, secretHint: hint, rotatedAt: now },
      });

    revalidatePath("/", "layout");
    return { secret };
  });

/** Hours, to one decimal — "2.5 h ago" is as precise as anyone needs. */
function hoursSince(then: Date, now: Date): number {
  return Math.round(((now.getTime() - then.getTime()) / 3_600_000) * 10) / 10;
}

/**
 * «Проверить подключение»: what the server can verify on its own side. It
 * cannot see the phone, so the last tap's age stands in for "the shortcut is
 * actually firing" — null means none has ever arrived.
 */
export const checkWalletConnection = authAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const { householdId } = ctx.user;
    const [status, defaultAccount, members] = await Promise.all([
      getWalletStatus(householdId),
      getDefaultAccount(householdId),
      db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.householdId, householdId)),
    ]);

    const checks = {
      secret: status.configured,
      defaultAccount: defaultAccount !== null,
      // The shortcut identifies the payer by email; a household with nobody
      // in it could not match one.
      members: members.length > 0,
      lastTapAgeHours:
        status.lastReceivedAt === null
          ? null
          : hoursSince(status.lastReceivedAt, new Date()),
    };

    return {
      ok: checks.secret && checks.defaultAccount && checks.members,
      checks,
    };
  });
