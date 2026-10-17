"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import {
  accountIdSchema,
  createAccountSchema,
  updateAccountSchema,
} from "@/lib/validations";
import { parseMoneyInput } from "@/lib/money";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export const createAccount = authAction
  .inputSchema(createAccountSchema)
  .action(async ({ parsedInput, ctx }) => {
    const parsed = parseMoneyInput(parsedInput.openingBalance, parsedInput.currency);
    if (!parsed.ok) throw new ActionError(parsed.error);

    const [maxOrder] = await db
      .select({ value: sql<number>`coalesce(max(${accounts.sortOrder}), -1)` })
      .from(accounts)
      .where(eq(accounts.householdId, ctx.user.householdId));

    // A household's first active account becomes the default, so the add
    // sheet and the Wallet webhook have somewhere to land from the start.
    const [activeDefault] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, ctx.user.householdId),
          eq(accounts.isDefault, true),
          isNull(accounts.archivedAt),
        ),
      )
      .limit(1);

    await db.insert(accounts).values({
      householdId: ctx.user.householdId,
      name: parsedInput.name,
      type: parsedInput.type,
      currency: parsedInput.currency,
      openingBalanceMinor: parsed.value,
      sortOrder: (maxOrder?.value ?? -1) + 1,
      isDefault: activeDefault === undefined,
    });

    revalidateAll();
    return { ok: true as const };
  });

export const updateAccount = authAction
  .inputSchema(updateAccountSchema)
  .action(async ({ parsedInput, ctx }) => {
    const parsed = parseMoneyInput(parsedInput.openingBalance, parsedInput.currency);
    if (!parsed.ok) throw new ActionError(parsed.error);

    const [existingAccount] = await db
      .select({ name: accounts.name, slug: accounts.slug })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, ctx.user.householdId),
          eq(accounts.id, parsedInput.id),
        ),
      )
      .limit(1);

    const updated = await db
      .update(accounts)
      .set({
        name: parsedInput.name,
        slug: await slugAfterEdit(
          existingAccount?.slug ?? null,
          existingAccount?.name ?? null,
          parsedInput.name,
        ),
        type: parsedInput.type,
        currency: parsedInput.currency,
        openingBalanceMinor: parsed.value,
      })
      .where(
        and(
          eq(accounts.householdId, ctx.user.householdId),
          eq(accounts.id, parsedInput.id),
        ),
      )
      .returning({ id: accounts.id });

    if (updated.length === 0) throw new ActionError("accountGone");

    revalidateAll();
    return { ok: true as const };
  });

/**
 * Accounts are archived, not deleted, so their history stays intact. An account
 * that has never been used is genuinely deleted, since there is nothing to keep.
 */
export const archiveAccount = authAction
  .inputSchema(accountIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;

    const [usage] = await db
      .select({ value: sql<string>`count(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.accountId, parsedInput.id),
        ),
      );

    const used = Number(usage?.value ?? 0) > 0;

    if (used) {
      // An archived account cannot be where new entries land; the default
      // falls back to the first active one until somebody picks again.
      await db
        .update(accounts)
        .set({ archivedAt: new Date(), isDefault: false })
        .where(
          and(eq(accounts.householdId, householdId), eq(accounts.id, parsedInput.id)),
        );
      revalidateAll();
      return { ok: true as const, archived: true };
    }

    await db
      .delete(accounts)
      .where(
        and(eq(accounts.householdId, householdId), eq(accounts.id, parsedInput.id)),
      );

    revalidateAll();
    return { ok: true as const, archived: false };
  });

export const restoreAccount = authAction
  .inputSchema(accountIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(accounts)
      .set({ archivedAt: null })
      .where(
        and(
          eq(accounts.householdId, ctx.user.householdId),
          eq(accounts.id, parsedInput.id),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });

/**
 * Makes one account the household's default. The old flag is cleared and the
 * new one set in a single transaction: the partial unique index allows only
 * one per household, so setting before clearing would fail, and two separate
 * statements could leave a moment with none.
 */
export const setDefaultAccount = authAction
  .inputSchema(accountIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), eq(accounts.id, parsedInput.id)))
        .limit(1);

      if (!target) throw new ActionError("accountGone");
      if (target.archivedAt !== null) throw new ActionError("archivedNotDefault");

      await tx
        .update(accounts)
        .set({ isDefault: false })
        .where(and(eq(accounts.householdId, householdId), eq(accounts.isDefault, true)));

      await tx
        .update(accounts)
        .set({ isDefault: true })
        .where(and(eq(accounts.householdId, householdId), eq(accounts.id, target.id)));
    });

    revalidateAll();
    return { ok: true as const };
  });
