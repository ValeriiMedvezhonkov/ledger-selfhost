"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { households, users } from "@/db/schema";
import { CATEGORY_COLOR_CHOICES } from "@/lib/chart-palette";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import {
  baseCurrencySchema,
  renameHouseholdSchema,
  updateMemberSchema,
} from "@/lib/validations";

/**
 * The «Семья» screen: the household's name, its currency, and each member's
 * name, colour and avatar. Either member may edit the other — it is a
 * two-person household, and the alternative is asking your partner to fix a
 * typo in your own name from their phone.
 */

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/**
 * The seeded slug survives only an unchanged save (see slugAfterEdit): a real
 * rename clears it, so the new name stops being overridden by the catalogue's
 * translation of "Home".
 */
export const renameHousehold = authAction
  .inputSchema(renameHouseholdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [existing] = await db
      .select({ name: households.name, slug: households.slug })
      .from(households)
      .where(eq(households.id, ctx.user.householdId))
      .limit(1);

    if (!existing) throw new ActionError("householdNotFound");

    await db
      .update(households)
      .set({
        name: parsedInput.name,
        slug: await slugAfterEdit(existing.slug, existing.name, parsedInput.name),
      })
      .where(eq(households.id, ctx.user.householdId));

    revalidateAll();
    return { ok: true as const };
  });

/**
 * Changes the currency totals are reported in.
 *
 * Existing rows are NOT re-converted — «Прошлые записи не пересчитываются».
 * Each keeps the rate captured when it was recorded, so history stays as it
 * was reported at the time rather than drifting with today's rate.
 */
export const setBaseCurrency = authAction
  .inputSchema(baseCurrencySchema)
  .action(async ({ parsedInput, ctx }) => {
    const updated = await db
      .update(households)
      .set({ baseCurrency: parsedInput.baseCurrency })
      .where(eq(households.id, ctx.user.householdId))
      .returning({ id: households.id });

    if (updated.length === 0) throw new ActionError("householdNotFound");

    revalidateAll();
    return { ok: true as const };
  });

/**
 * Edits a member's name, colour and avatar emoji.
 *
 * The colour must come from the validated chart palette (NOTES.md, "Chart
 * colours are validated, not chosen") — member colours tint the per-person
 * charts. A colour already stored is accepted unchanged, so a member created
 * with the old default can still save their name without being forced to
 * repaint.
 */
export const updateMember = authAction
  .inputSchema(updateMemberSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [member] = await db
      .select({ id: users.id, color: users.color })
      .from(users)
      .where(
        and(
          eq(users.id, parsedInput.userId),
          eq(users.householdId, ctx.user.householdId),
        ),
      )
      .limit(1);

    if (!member) throw new ActionError("notHouseholdMember");

    const color = parsedInput.color.toLowerCase();
    const allowed =
      CATEGORY_COLOR_CHOICES.some((choice) => choice.toLowerCase() === color) ||
      member.color.toLowerCase() === color;
    if (!allowed) throw new ActionError("colourNotInPalette");

    await db
      .update(users)
      .set({
        displayName: parsedInput.displayName,
        color,
        avatarEmoji: parsedInput.avatarEmoji,
      })
      .where(
        and(
          eq(users.id, member.id),
          eq(users.householdId, ctx.user.householdId),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });
