"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { goalContributions, goals } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import {
  contributeSchema,
  createGoalSchema,
  goalIdSchema,
  updateGoalSchema,
} from "@/lib/validations";
import { parseMoneyInput } from "@/lib/money";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export const createGoal = authAction
  .inputSchema(createGoalSchema)
  .action(async ({ parsedInput, ctx }) => {
    const parsed = parseMoneyInput(parsedInput.target, parsedInput.currency);
    if (!parsed.ok) throw new ActionError(parsed.error);
    if (parsed.value <= 0) throw new ActionError("goalAboveZero");

    await db.insert(goals).values({
      householdId: ctx.user.householdId,
      name: parsedInput.name,
      targetMinor: parsed.value,
      currency: parsedInput.currency,
      targetDate: parsedInput.targetDate ?? null,
      accountId: parsedInput.accountId ?? null,
    });

    revalidateAll();
    return { ok: true as const };
  });

export const updateGoal = authAction
  .inputSchema(updateGoalSchema)
  .action(async ({ parsedInput, ctx }) => {
    const parsed = parseMoneyInput(parsedInput.target, parsedInput.currency);
    if (!parsed.ok) throw new ActionError(parsed.error);
    if (parsed.value <= 0) throw new ActionError("goalAboveZero");

    const [existingGoal] = await db
      .select({ name: goals.name, slug: goals.slug })
      .from(goals)
      .where(
        and(eq(goals.householdId, ctx.user.householdId), eq(goals.id, parsedInput.id)),
      )
      .limit(1);

    const updated = await db
      .update(goals)
      .set({
        name: parsedInput.name,
        slug: await slugAfterEdit(
          existingGoal?.slug ?? null,
          existingGoal?.name ?? null,
          parsedInput.name,
        ),
        targetMinor: parsed.value,
        currency: parsedInput.currency,
        targetDate: parsedInput.targetDate ?? null,
        accountId: parsedInput.accountId ?? null,
      })
      .where(
        and(
          eq(goals.householdId, ctx.user.householdId),
          eq(goals.id, parsedInput.id),
        ),
      )
      .returning({ id: goals.id });

    if (updated.length === 0) throw new ActionError("goalGone");

    revalidateAll();
    return { ok: true as const };
  });

export const archiveGoal = authAction
  .inputSchema(goalIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(goals)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(goals.householdId, ctx.user.householdId),
          eq(goals.id, parsedInput.id),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });

export const contributeToGoal = authAction
  .inputSchema(contributeSchema)
  .action(async ({ parsedInput, ctx }) => {
    const rows = await db
      .select({ id: goals.id, currency: goals.currency })
      .from(goals)
      .where(
        and(
          eq(goals.householdId, ctx.user.householdId),
          eq(goals.id, parsedInput.goalId),
        ),
      )
      .limit(1);

    const goal = rows[0];
    if (!goal) throw new ActionError("goalGone");

    const parsed = parseMoneyInput(parsedInput.amount, goal.currency);
    if (!parsed.ok) throw new ActionError(parsed.error);
    if (parsed.value === 0) throw new ActionError("amountNotZero");

    await db.insert(goalContributions).values({
      goalId: goal.id,
      amountMinor: parsed.value,
      occurredOn: parsedInput.occurredOn,
    });

    revalidateAll();
    return { ok: true as const };
  });
