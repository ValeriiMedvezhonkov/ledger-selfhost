"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { households, users } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import { householdSchema, profileSchema } from "@/lib/validations";

export const updateProfile = authAction
  .inputSchema(profileSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(users)
      .set({ displayName: parsedInput.displayName, color: parsedInput.color })
      .where(eq(users.id, ctx.user.id));

    revalidatePath("/", "layout");
    return { ok: true as const };
  });

/**
 * Changing the base currency does NOT re-convert existing rows: each
 * transaction keeps the rate captured when it was recorded. Historical totals
 * therefore stay as they were reported at the time.
 */
export const updateHousehold = authAction
  .inputSchema(householdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [existingHousehold] = await db
      .select({ name: households.name, slug: households.slug })
      .from(households)
      .where(eq(households.id, ctx.user.householdId))
      .limit(1);

    const updated = await db
      .update(households)
      .set({
        name: parsedInput.name,
        slug: await slugAfterEdit(
          existingHousehold?.slug ?? null,
          existingHousehold?.name ?? null,
          parsedInput.name,
        ),
        baseCurrency: parsedInput.baseCurrency,
      })
      .where(eq(households.id, ctx.user.householdId))
      .returning({ id: households.id });

    if (updated.length === 0) throw new ActionError("householdNotFound");

    revalidatePath("/", "layout");
    return { ok: true as const };
  });
