"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, recurringRules, users } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import {
  createRecurringSchema,
  recurringIdSchema,
  toggleRecurringSchema,
  updateRecurringSchema,
} from "@/lib/validations";
import { negateMinor, parseMoneyInput, type Minor } from "@/lib/money";
import { advanceByFrequency, compareISO, todayISO } from "@/lib/date";
import { serverNow } from "@/lib/now";
import type { RecurringFormValues } from "@/lib/validations";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

interface Resolved {
  readonly amountMinor: Minor;
  readonly categoryId: string | null;
  readonly paidByUserId: string;
}

async function resolve(
  householdId: string,
  values: RecurringFormValues,
): Promise<Resolved> {
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.householdId, householdId), eq(accounts.id, values.accountId)),
    )
    .limit(1);
  if (!account[0]) throw new ActionError("accountMissing");

  let categoryId: string | null = null;
  if (values.categoryId != null) {
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.id, values.categoryId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ActionError("categoryMissing");
    categoryId = values.categoryId;
  }

  const member = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.householdId, householdId), eq(users.id, values.paidByUserId)),
    )
    .limit(1);
  if (!member[0]) throw new ActionError("notHouseholdMember");

  const parsed = parseMoneyInput(values.amount, values.currency);
  if (!parsed.ok) throw new ActionError(parsed.error);
  if (parsed.value === 0) throw new ActionError("amountNotZero");

  const magnitude = Math.abs(parsed.value) as Minor;

  return {
    amountMinor: values.type === "income" ? magnitude : negateMinor(magnitude),
    categoryId,
    paidByUserId: values.paidByUserId,
  };
}

/**
 * The first run is the start date itself if it is still in the future, or the
 * next occurrence on or after today — so adding a rule dated last year does not
 * immediately backfill a year of transactions.
 */
function firstRun(values: RecurringFormValues): string {
  const today = todayISO(serverNow());
  let cursor = values.startOn;
  let guard = 0;

  while (compareISO(cursor, today) < 0 && guard < 1000) {
    cursor = advanceByFrequency(cursor, values.frequency, values.interval);
    guard += 1;
  }

  return cursor;
}

export const createRecurring = authAction
  .inputSchema(createRecurringSchema)
  .action(async ({ parsedInput, ctx }) => {
    const resolved = await resolve(ctx.user.householdId, parsedInput);

    await db.insert(recurringRules).values({
      householdId: ctx.user.householdId,
      accountId: parsedInput.accountId,
      categoryId: resolved.categoryId,
      paidByUserId: resolved.paidByUserId,
      name: parsedInput.name,
      type: parsedInput.type,
      amountMinor: resolved.amountMinor,
      currency: parsedInput.currency,
      note: parsedInput.note,
      frequency: parsedInput.frequency,
      interval: parsedInput.interval,
      startOn: parsedInput.startOn,
      endOn: parsedInput.endOn ?? null,
      nextRunOn: firstRun(parsedInput),
      active: true,
    });

    revalidateAll();
    return { ok: true as const };
  });

export const updateRecurring = authAction
  .inputSchema(updateRecurringSchema)
  .action(async ({ parsedInput, ctx }) => {
    const resolved = await resolve(ctx.user.householdId, parsedInput);

    const [existingRule] = await db
      .select({
        name: recurringRules.name,
        slug: recurringRules.slug,
        note: recurringRules.note,
        noteSlug: recurringRules.noteSlug,
      })
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.householdId, ctx.user.householdId),
          eq(recurringRules.id, parsedInput.id),
        ),
      )
      .limit(1);

    const updated = await db
      .update(recurringRules)
      .set({
        accountId: parsedInput.accountId,
        slug: await slugAfterEdit(
          existingRule?.slug ?? null,
          existingRule?.name ?? null,
          parsedInput.name,
        ),
        noteSlug: await slugAfterEdit(
          existingRule?.noteSlug ?? null,
          existingRule?.note ?? null,
          parsedInput.note ?? null,
        ),
        categoryId: resolved.categoryId,
        paidByUserId: resolved.paidByUserId,
        name: parsedInput.name,
        type: parsedInput.type,
        amountMinor: resolved.amountMinor,
        currency: parsedInput.currency,
        note: parsedInput.note,
        frequency: parsedInput.frequency,
        interval: parsedInput.interval,
        startOn: parsedInput.startOn,
        endOn: parsedInput.endOn ?? null,
      })
      .where(
        and(
          eq(recurringRules.householdId, ctx.user.householdId),
          eq(recurringRules.id, parsedInput.id),
        ),
      )
      .returning({ id: recurringRules.id });

    if (updated.length === 0) throw new ActionError("ruleGone");

    revalidateAll();
    return { ok: true as const };
  });

export const toggleRecurring = authAction
  .inputSchema(toggleRecurringSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(recurringRules)
      .set({ active: parsedInput.active })
      .where(
        and(
          eq(recurringRules.householdId, ctx.user.householdId),
          eq(recurringRules.id, parsedInput.id),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });

/** Push the next occurrence one step forward without creating a transaction. */
export const skipNextRecurring = authAction
  .inputSchema(recurringIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const rows = await db
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.householdId, ctx.user.householdId),
          eq(recurringRules.id, parsedInput.id),
        ),
      )
      .limit(1);

    const rule = rows[0];
    if (!rule) throw new ActionError("ruleGone");

    const next = advanceByFrequency(
      rule.nextRunOn,
      rule.frequency,
      rule.interval,
    );

    await db
      .update(recurringRules)
      .set({ nextRunOn: next })
      .where(eq(recurringRules.id, rule.id));

    revalidateAll();
    return { ok: true as const, nextRunOn: next };
  });

export const deleteRecurring = authAction
  .inputSchema(recurringIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .delete(recurringRules)
      .where(
        and(
          eq(recurringRules.householdId, ctx.user.householdId),
          eq(recurringRules.id, parsedInput.id),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });
