"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgets, categories } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import {
  budgetIdSchema,
  copyBudgetsSchema,
  createBudgetSchema,
  updateBudgetSchema,
} from "@/lib/validations";
import { parseMoneyInput } from "@/lib/money";
import { monthStartISO } from "@/lib/date";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

async function assertCategory(
  householdId: string,
  categoryId: string,
): Promise<void> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.householdId, householdId), eq(categories.id, categoryId)),
    )
    .limit(1);
  if (!rows[0]) throw new ActionError("categoryMissing");
}

export const createBudget = authAction
  .inputSchema(createBudgetSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, baseCurrency } = ctx.user;
    await assertCategory(householdId, parsedInput.categoryId);

    const parsed = parseMoneyInput(parsedInput.limit, baseCurrency);
    if (!parsed.ok) throw new ActionError(parsed.error);
    if (parsed.value <= 0) throw new ActionError("budgetAboveZero");

    // Budgets are per calendar month; normalise whatever date arrives.
    const periodStart = monthStartISO(parsedInput.periodStart);

    const existing = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          eq(budgets.categoryId, parsedInput.categoryId),
          eq(budgets.periodStart, periodStart),
        ),
      )
      .limit(1);

    if (existing[0]) {
      throw new ActionError("budgetDuplicate");
    }

    await db.insert(budgets).values({
      householdId,
      categoryId: parsedInput.categoryId,
      periodStart,
      limitMinor: parsed.value,
      currency: baseCurrency,
    });

    revalidateAll();
    return { ok: true as const };
  });

export const updateBudget = authAction
  .inputSchema(updateBudgetSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, baseCurrency } = ctx.user;
    const parsed = parseMoneyInput(parsedInput.limit, baseCurrency);
    if (!parsed.ok) throw new ActionError(parsed.error);
    if (parsed.value <= 0) throw new ActionError("budgetAboveZero");

    const updated = await db
      .update(budgets)
      .set({ limitMinor: parsed.value })
      .where(
        and(eq(budgets.householdId, householdId), eq(budgets.id, parsedInput.id)),
      )
      .returning({ id: budgets.id });

    if (updated.length === 0) throw new ActionError("budgetGone");

    revalidateAll();
    return { ok: true as const };
  });

export const deleteBudget = authAction
  .inputSchema(budgetIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.householdId, ctx.user.householdId),
          eq(budgets.id, parsedInput.id),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });

/** Carry a whole month's budgets forward, skipping categories already set. */
export const copyBudgets = authAction
  .inputSchema(copyBudgetsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;
    const from = monthStartISO(parsedInput.fromPeriod);
    const to = monthStartISO(parsedInput.toPeriod);

    if (from === to) throw new ActionError("pickTwoMonths");

    const copied = await db.transaction(async (tx) => {
      const source = await tx
        .select()
        .from(budgets)
        .where(
          and(eq(budgets.householdId, householdId), eq(budgets.periodStart, from)),
        );

      if (source.length === 0) {
        throw new ActionError("noBudgetsToCopy");
      }

      const target = await tx
        .select({ categoryId: budgets.categoryId })
        .from(budgets)
        .where(
          and(eq(budgets.householdId, householdId), eq(budgets.periodStart, to)),
        );

      const taken = new Set(target.map((row) => row.categoryId));
      const rows = source
        .filter((row) => !taken.has(row.categoryId))
        .map((row) => ({
          householdId,
          categoryId: row.categoryId,
          periodStart: to,
          limitMinor: row.limitMinor,
          currency: row.currency,
        }));

      if (rows.length === 0) return 0;

      await tx.insert(budgets).values(rows);
      return rows.length;
    });

    revalidateAll();
    return { ok: true as const, copied };
  });
