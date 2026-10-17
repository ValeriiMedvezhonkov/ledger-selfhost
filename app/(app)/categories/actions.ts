"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { getCategoryNamer } from "@/lib/category-name";
import {
  createCategorySchema,
  deleteCategorySchema,
  updateCategorySchema,
} from "@/lib/validations";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export const createCategory = authAction
  .inputSchema(createCategorySchema)
  .action(async ({ parsedInput, ctx }) => {
    await db.insert(categories).values({
      householdId: ctx.user.householdId,
      name: parsedInput.name,
      kind: parsedInput.kind,
      icon: parsedInput.icon,
      color: parsedInput.color,
      parentId: parsedInput.parentId ?? null,
    });

    revalidateAll();
    return { ok: true as const };
  });

export const updateCategory = authAction
  .inputSchema(updateCategorySchema)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.parentId === parsedInput.id) {
      throw new ActionError("categoryOwnParent");
    }

    /*
     * A shipped category shows a translated name, so the form submits that
     * translation, not the stored one. "Did the name change?" therefore has to
     * be asked against what the user was actually shown — comparing with the
     * stored name would read every untouched save as a rename.
     *
     * A real rename drops the slug: an explicit choice should not keep being
     * overridden by the catalogue, and it stops the name flipping language
     * afterwards.
     */
    const [existing] = await db
      .select({ name: categories.name, slug: categories.slug })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, ctx.user.householdId),
          eq(categories.id, parsedInput.id),
        ),
      )
      .limit(1);

    const nameCategory = await getCategoryNamer();
    const shownName =
      existing === undefined
        ? null
        : nameCategory(existing.slug, existing.name);
    const renamed = shownName !== null && parsedInput.name !== shownName;

    const updated = await db
      .update(categories)
      .set({
        name: parsedInput.name,
        kind: parsedInput.kind,
        icon: parsedInput.icon,
        color: parsedInput.color,
        parentId: parsedInput.parentId ?? null,
        ...(renamed ? { slug: null } : {}),
      })
      .where(
        and(
          eq(categories.householdId, ctx.user.householdId),
          eq(categories.id, parsedInput.id),
        ),
      )
      .returning({ id: categories.id });

    if (updated.length === 0) {
      throw new ActionError("categoryGone");
    }

    revalidateAll();
    return { ok: true as const };
  });

/**
 * Deleting a category must never orphan a transaction. Every affected row is
 * moved to the chosen replacement (or the household's system "Uncategorized"
 * category) inside the same database transaction as the delete.
 */
export const deleteCategory = authAction
  .inputSchema(deleteCategorySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: categories.id, isSystem: categories.isSystem })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.id, parsedInput.id),
          ),
        )
        .limit(1);

      if (!target) throw new ActionError("categoryGone");
      if (target.isSystem) {
        throw new ActionError("fallbackUndeletable");
      }

      let replacementId = parsedInput.reassignToId;

      if (replacementId === null) {
        const [fallback] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.householdId, householdId),
              eq(categories.isSystem, true),
            ),
          )
          .limit(1);

        if (fallback) {
          replacementId = fallback.id;
        } else {
          const [created] = await tx
            .insert(categories)
            .values({
              householdId,
              name: "Uncategorized",
              // Shipped, so it reads in the interface language; the stored
              // name is only the fallback if the message ever goes missing.
              slug: "uncategorised",
              kind: "expense",
              icon: "CircleHelp",
              color: "#94a3b8",
              isSystem: true,
            })
            .returning({ id: categories.id });
          if (!created) throw new ActionError("fallbackCreateFailed");
          replacementId = created.id;
        }
      } else {
        const [replacement] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.householdId, householdId),
              eq(categories.id, replacementId),
            ),
          )
          .limit(1);
        if (!replacement) throw new ActionError("replacementMissing");
      }

      if (replacementId === parsedInput.id) {
        throw new ActionError("chooseDifferentCategory");
      }

      await tx
        .update(transactions)
        .set({ categoryId: replacementId })
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.categoryId, parsedInput.id),
          ),
        );

      // Child categories are promoted rather than silently deleted.
      await tx
        .update(categories)
        .set({ parentId: null })
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.parentId, parsedInput.id),
          ),
        );

      await tx
        .delete(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.id, parsedInput.id),
          ),
        );
    });

    revalidateAll();
    return { ok: true as const };
  });
