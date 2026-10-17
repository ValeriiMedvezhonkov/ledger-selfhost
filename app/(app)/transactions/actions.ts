"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  accounts,
  categories,
  recurringRules,
  transactions,
  transferLinks,
  users,
} from "@/db/schema";
import { getCategoryNamer } from "@/lib/category-name";
import { countTransactions } from "@/lib/queries";
import { ActionError, authAction } from "@/lib/safe-action";
import { slugAfterEdit } from "@/lib/seeded-name";
import {
  SPLIT_PAID_BY,
  changeCategorySchema,
  createTransactionSchema,
  deleteManySchema,
  makeRecurringSchema,
  transactionFilterSchema,
  transactionIdSchema,
  updateTransactionSchema,
  type TransactionFormValues,
} from "@/lib/validations";
import {
  ONE_TO_ONE,
  convertToBase,
  negateMinor,
  parseMoneyInput,
  parseRateInput,
  splitMinor,
  type Minor,
  type ScaledRate,
} from "@/lib/money";
import { advanceByFrequency, compareISO, todayISO, type ISODate } from "@/lib/date";
import { serverNow } from "@/lib/now";

/** A Drizzle transaction handle — the same query surface as `db`. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Resolved, household-verified values for a transaction write. Everything that
 * can reference another row is checked against the caller's household here, so
 * no action can write across the household boundary even if the client lies.
 */
interface ResolvedTransaction {
  readonly amountMinor: Minor;
  readonly amountBaseMinor: Minor;
  readonly rate: ScaledRate;
  readonly categoryId: string | null;
  /**
   * One member, or both for a «пополам» entry — the entering member first,
   * because the first half is the one that carries an odd cent.
   */
  readonly paidBy:
    | { readonly kind: "member"; readonly userId: string }
    | { readonly kind: "split"; readonly userIds: readonly [string, string] };
}

/**
 * The two members a split is shared between, the actor first.
 *
 * A split is defined for exactly two people. With one there is nobody to share
 * with; with three, "half" stops meaning anything and the form would need a
 * share editor this app does not have.
 */
async function splitPartners(
  householdId: string,
  actorId: string,
): Promise<readonly [string, string]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.householdId, householdId));

  const other = rows.find((row) => row.id !== actorId);
  if (rows.length !== 2 || other === undefined || !rows.some((row) => row.id === actorId)) {
    throw new ActionError("splitNeedsTwoMembers");
  }
  return [actorId, other.id];
}

async function assertAccount(
  householdId: string,
  accountId: string,
): Promise<void> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
    .limit(1);
  if (!rows[0]) throw new ActionError("accountMissing");
}

async function resolve(
  householdId: string,
  baseCurrency: string,
  actorId: string,
  values: TransactionFormValues,
): Promise<ResolvedTransaction> {
  await assertAccount(householdId, values.accountId);
  if (values.type === "transfer" && values.toAccountId !== undefined) {
    await assertAccount(householdId, values.toAccountId);
  }

  let categoryId: string | null = null;
  if (values.type !== "transfer") {
    const requested = values.categoryId ?? null;
    if (requested === null) throw new ActionError("chooseCategory");
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.id, requested),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ActionError("categoryMissing");
    categoryId = requested;
  }

  let paidBy: ResolvedTransaction["paidBy"];
  if (values.paidByUserId === SPLIT_PAID_BY) {
    // Moving your own money between accounts has nobody to share it with.
    if (values.type === "transfer") throw new ActionError("splitNotForTransfers");
    paidBy = { kind: "split", userIds: await splitPartners(householdId, actorId) };
  } else {
    const member = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.householdId, householdId), eq(users.id, values.paidByUserId)),
      )
      .limit(1);
    if (!member[0]) throw new ActionError("notHouseholdMember");
    paidBy = { kind: "member", userId: values.paidByUserId };
  }

  const parsed = parseMoneyInput(values.amount, values.currency);
  if (!parsed.ok) throw new ActionError(parsed.error);
  if (parsed.value === 0) throw new ActionError("amountNotZero");

  // The form takes a magnitude; direction comes from the transaction type.
  const magnitude = (Math.abs(parsed.value) as Minor);
  const amountMinor =
    values.type === "income" ? magnitude : negateMinor(magnitude);

  let rate: ScaledRate = ONE_TO_ONE;
  if (values.currency !== baseCurrency) {
    if (values.fxRate === undefined || values.fxRate.trim() === "") {
      throw new ActionError(
        `Enter the rate from ${values.currency} to ${baseCurrency}.`,
      );
    }
    const parsedRate = parseRateInput(values.fxRate);
    if (!parsedRate.ok) throw new ActionError(parsedRate.error);
    rate = parsedRate.value;
  }

  return {
    amountMinor,
    amountBaseMinor: convertToBase(amountMinor, rate),
    rate,
    categoryId,
    paidBy,
  };
}

/** Empty or whitespace-only text is no text. Used for merchant and note alike. */
function normalizeText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/**
 * The clock time to record with an entry: now, but only when the entry is for
 * today. A back-dated entry's time is unknown, and stamping it with the moment
 * it was typed would put "23:41" on Tuesday's lunch.
 */
function occurredAtFor(occurredOn: ISODate, now: Date): Date | null {
  return occurredOn === todayISO(now) ? now : null;
}

/**
 * The two rows of a split, from the full amount. The first member — the actor —
 * gets the half with the odd minor unit, in the entry currency and in base
 * alike, so each pair sums exactly to the original on both columns.
 */
function splitAmounts(
  amountMinor: Minor,
  amountBaseMinor: Minor,
): readonly [
  { readonly amountMinor: Minor; readonly amountBaseMinor: Minor },
  { readonly amountMinor: Minor; readonly amountBaseMinor: Minor },
] {
  const [firstAmount, secondAmount] = splitMinor(amountMinor);
  const [firstBase, secondBase] = splitMinor(amountBaseMinor);
  return [
    { amountMinor: firstAmount, amountBaseMinor: firstBase },
    { amountMinor: secondAmount, amountBaseMinor: secondBase },
  ];
}

/**
 * Splits an existing, unsplit row in two: the row keeps its id and becomes
 * one half, a new row is the other. The actor always holds the larger half,
 * whichever of the two rows that turns out to be.
 */
async function splitExistingRow(
  tx: Tx,
  householdId: string,
  id: string,
  partners: readonly [string, string],
  actorId: string,
): Promise<void> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)))
    .limit(1)
    .for("update");

  if (!row) throw new ActionError("transactionGone");
  if (row.type === "transfer") throw new ActionError("splitNotForTransfers");
  if (row.splitGroupId !== null) throw new ActionError("alreadySplit");

  const [actorHalf, otherHalf] = splitAmounts(row.amountMinor, row.amountBaseMinor);
  const [actor, other] = partners;
  // The existing row stays with whoever it was attributed to, if that is one
  // of the two; the new row goes to the other person.
  const keeper = row.paidByUserId === other ? other : actor;
  const newcomer = keeper === actor ? other : actor;
  const keeperHalf = keeper === actor ? actorHalf : otherHalf;
  const newcomerHalf = keeper === actor ? otherHalf : actorHalf;
  const splitGroupId = randomUUID();

  await tx
    .update(transactions)
    .set({
      paidByUserId: keeper,
      amountMinor: keeperHalf.amountMinor,
      amountBaseMinor: keeperHalf.amountBaseMinor,
      splitGroupId,
      updatedByUserId: actorId,
      updatedAt: new Date(),
    })
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)));

  await tx.insert(transactions).values({
    householdId,
    accountId: row.accountId,
    categoryId: row.categoryId,
    createdByUserId: actorId,
    paidByUserId: newcomer,
    type: row.type,
    amountMinor: newcomerHalf.amountMinor,
    currency: row.currency,
    fxRateToBase: row.fxRateToBase,
    amountBaseMinor: newcomerHalf.amountBaseMinor,
    occurredOn: row.occurredOn,
    occurredAt: row.occurredAt,
    merchant: row.merchant,
    merchantSlug: row.merchantSlug,
    note: row.note,
    noteSlug: row.noteSlug,
    source: row.source,
    recurringRuleId: row.recurringRuleId,
    splitGroupId,
  });
}

/** A row the caller owns, or ActionError("transactionGone"). */
async function ownedTransaction(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)))
    .limit(1);
  if (!row) throw new ActionError("transactionGone");
  return row;
}

export const createTransaction = authAction
  .inputSchema(createTransactionSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, baseCurrency, id: actorId } = ctx.user;
    const resolved = await resolve(householdId, baseCurrency, actorId, parsedInput);
    const now = serverNow();
    const occurredAt = occurredAtFor(parsedInput.occurredOn, now);
    const merchant = normalizeText(parsedInput.merchant);
    const note = normalizeText(parsedInput.note);

    if (parsedInput.type === "transfer") {
      // resolve() refuses a split transfer, so this is always one member.
      const paidByUserId =
        resolved.paidBy.kind === "member" ? resolved.paidBy.userId : actorId;
      const toAccountId = parsedInput.toAccountId;
      if (toAccountId === undefined) {
        throw new ActionError("chooseTransferTarget");
      }

      // Both legs and the link succeed together, or none of them do.
      const ids = await db.transaction(async (tx) => {
        const outgoingAmount = resolved.amountMinor;
        const incomingAmount = negateMinor(outgoingAmount);

        const [outgoing] = await tx
          .insert(transactions)
          .values({
            householdId,
            accountId: parsedInput.accountId,
            categoryId: null,
            createdByUserId: actorId,
            paidByUserId,
            type: "transfer",
            amountMinor: outgoingAmount,
            currency: parsedInput.currency,
            fxRateToBase: resolved.rate,
            amountBaseMinor: resolved.amountBaseMinor,
            occurredOn: parsedInput.occurredOn,
            occurredAt,
            merchant,
            note,
            source: "manual",
          })
          .returning({ id: transactions.id });

        const [incoming] = await tx
          .insert(transactions)
          .values({
            householdId,
            accountId: toAccountId,
            categoryId: null,
            createdByUserId: actorId,
            paidByUserId,
            type: "transfer",
            amountMinor: incomingAmount,
            currency: parsedInput.currency,
            fxRateToBase: resolved.rate,
            amountBaseMinor: negateMinor(resolved.amountBaseMinor),
            occurredOn: parsedInput.occurredOn,
            occurredAt,
            merchant,
            note,
            source: "manual",
          })
          .returning({ id: transactions.id });

        if (!outgoing || !incoming) {
          throw new ActionError("transferFailed");
        }

        await tx.insert(transferLinks).values({
          fromTransactionId: outgoing.id,
          toTransactionId: incoming.id,
        });

        return [outgoing.id, incoming.id];
      });

      revalidateAll();
      return { ok: true as const, ids };
    }

    const shared = {
      householdId,
      accountId: parsedInput.accountId,
      categoryId: resolved.categoryId,
      createdByUserId: actorId,
      type: parsedInput.type,
      currency: parsedInput.currency,
      fxRateToBase: resolved.rate,
      occurredOn: parsedInput.occurredOn,
      occurredAt,
      merchant,
      note,
      source: "manual" as const,
    };

    if (resolved.paidBy.kind === "split") {
      // Two ordinary rows rather than one row with a share: every per-person
      // total, budget and chart already sums by paid_by, and keeps working
      // without learning that splits exist.
      const [first, second] = splitAmounts(
        resolved.amountMinor,
        resolved.amountBaseMinor,
      );
      const [firstUser, secondUser] = resolved.paidBy.userIds;
      const splitGroupId = randomUUID();

      const created = await db
        .insert(transactions)
        .values([
          { ...shared, ...first, paidByUserId: firstUser, splitGroupId },
          { ...shared, ...second, paidByUserId: secondUser, splitGroupId },
        ])
        .returning({ id: transactions.id });

      revalidateAll();
      return { ok: true as const, ids: created.map((row) => row.id) };
    }

    const created = await db
      .insert(transactions)
      .values({
        ...shared,
        paidByUserId: resolved.paidBy.userId,
        amountMinor: resolved.amountMinor,
        amountBaseMinor: resolved.amountBaseMinor,
      })
      .returning({ id: transactions.id });

    revalidateAll();
    return { ok: true as const, ids: created.map((row) => row.id) };
  });

export const updateTransaction = authAction
  .inputSchema(updateTransactionSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, baseCurrency, id: actorId } = ctx.user;
    const { id, values } = parsedInput;

    const existing = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        paidByUserId: transactions.paidByUserId,
        merchant: transactions.merchant,
        merchantSlug: transactions.merchantSlug,
        note: transactions.note,
        noteSlug: transactions.noteSlug,
        splitGroupId: transactions.splitGroupId,
      })
      .from(transactions)
      .where(
        and(eq(transactions.householdId, householdId), eq(transactions.id, id)),
      )
      .limit(1);

    const current = existing[0];
    if (!current) throw new ActionError("transactionGone");

    if (current.type === "transfer" || values.type === "transfer") {
      throw new ActionError("transferNotEditable");
    }

    const resolved = await resolve(householdId, baseCurrency, actorId, values);
    const merchant = normalizeText(values.merchant);
    const note = normalizeText(values.note);

    /*
     * "Пополам" on an edit means one of two things. On a row that is already
     * a half it means "leave the split alone": this row keeps its person and
     * the edit applies to this half. On a whole row it means "split this" —
     * the row is saved with the full amount, then halved, in one transaction.
     */
    const splitAfterSave =
      resolved.paidBy.kind === "split" && current.splitGroupId === null
        ? resolved.paidBy.userIds
        : null;
    const paidByUserId =
      resolved.paidBy.kind === "member"
        ? resolved.paidBy.userId
        : (current.paidByUserId ?? actorId);

    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({
          accountId: values.accountId,
          categoryId: resolved.categoryId,
          paidByUserId,
          type: values.type,
          amountMinor: resolved.amountMinor,
          currency: values.currency,
          fxRateToBase: resolved.rate,
          amountBaseMinor: resolved.amountBaseMinor,
          occurredOn: values.occurredOn,
          merchant,
          merchantSlug: await slugAfterEdit(
            current.merchantSlug,
            current.merchant,
            merchant,
          ),
          note,
          noteSlug: await slugAfterEdit(current.noteSlug, current.note, note),
          // Who edited is tracked separately from who entered, so an on-behalf-of
          // record keeps its original author after someone corrects a typo.
          updatedByUserId: actorId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(transactions.householdId, householdId), eq(transactions.id, id)),
        );

      if (splitAfterSave !== null) {
        await splitExistingRow(tx, householdId, id, splitAfterSave, actorId);
      }
    });

    revalidateAll();
    return { ok: true as const };
  });

/** Deleting either leg of a transfer removes both; a half transfer is nonsense. */
export const deleteTransaction = authAction
  .inputSchema(transactionIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;

    await db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.id, parsedInput.id),
          ),
        )
        .limit(1);

      if (!owned[0]) throw new ActionError("transactionGone");

      const partners = await tx
        .select({
          from: transferLinks.fromTransactionId,
          to: transferLinks.toTransactionId,
        })
        .from(transferLinks)
        .where(
          eq(transferLinks.fromTransactionId, parsedInput.id),
        );

      const reversePartners = await tx
        .select({
          from: transferLinks.fromTransactionId,
          to: transferLinks.toTransactionId,
        })
        .from(transferLinks)
        .where(eq(transferLinks.toTransactionId, parsedInput.id));

      const ids = new Set<string>([parsedInput.id]);
      for (const link of [...partners, ...reversePartners]) {
        ids.add(link.from);
        ids.add(link.to);
      }

      await tx
        .delete(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            inArray(transactions.id, [...ids]),
          ),
        );
    });

    revalidateAll();
    return { ok: true as const };
  });

export const deleteTransactions = authAction
  .inputSchema(deleteManySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;

    const deleted = await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          inArray(transactions.id, parsedInput.ids),
        ),
      )
      .returning({ id: transactions.id });

    revalidateAll();
    return { ok: true as const, count: deleted.length };
  });

/**
 * «Повторить» — the same entry again, dated today. A split is copied as a
 * split (both halves, a fresh group), since copying one half would quietly
 * attribute half a purchase. The copy is a new manual entry: it has no rule
 * behind it, and its clock time is now.
 */
export const duplicateTransaction = authAction
  .inputSchema(transactionIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, id: actorId } = ctx.user;
    const row = await ownedTransaction(householdId, parsedInput.id);
    if (row.type === "transfer") throw new ActionError("transferNotDuplicable");

    const group =
      row.splitGroupId === null
        ? [row]
        : await db
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, householdId),
                eq(transactions.splitGroupId, row.splitGroupId),
              ),
            );

    const now = serverNow();
    const splitGroupId = group.length > 1 ? randomUUID() : null;

    const created = await db
      .insert(transactions)
      .values(
        group.map((source) => ({
          householdId,
          accountId: source.accountId,
          categoryId: source.categoryId,
          createdByUserId: actorId,
          paidByUserId: source.paidByUserId,
          type: source.type,
          amountMinor: source.amountMinor,
          currency: source.currency,
          fxRateToBase: source.fxRateToBase,
          amountBaseMinor: source.amountBaseMinor,
          occurredOn: todayISO(now),
          occurredAt: now,
          merchant: source.merchant,
          merchantSlug: source.merchantSlug,
          note: source.note,
          noteSlug: source.noteSlug,
          source: "manual" as const,
          splitGroupId,
        })),
      )
      .returning({ id: transactions.id, paidByUserId: transactions.paidByUserId });

    revalidateAll();
    // The copy of the row that was tapped, so the client can open it.
    const tapped =
      created.find((item) => item.paidByUserId === row.paidByUserId) ?? created[0];
    return { ok: true as const, id: tapped?.id ?? null, ids: created.map((item) => item.id) };
  });

/** «Разделить пополам» on an existing entry. */
export const splitTransaction = authAction
  .inputSchema(transactionIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, id: actorId } = ctx.user;
    const partners = await splitPartners(householdId, actorId);

    await db.transaction(async (tx) => {
      await splitExistingRow(tx, householdId, parsedInput.id, partners, actorId);
    });

    revalidateAll();
    return { ok: true as const };
  });

/**
 * «Сделать регулярной» — a rule built from this entry, and the entry linked to
 * it as its first occurrence.
 *
 * The next run is the first occurrence strictly after both the entry's date and
 * today: the entry itself already covers its own date, and a rule made from
 * last month's rent must not immediately materialise last month again.
 */
export const makeTransactionRecurring = authAction
  .inputSchema(makeRecurringSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId } = ctx.user;
    const row = await ownedTransaction(householdId, parsedInput.id);
    if (row.type === "transfer") throw new ActionError("transferNotRecurring");

    if (row.recurringRuleId !== null) {
      const [linked] = await db
        .select({ active: recurringRules.active })
        .from(recurringRules)
        .where(
          and(
            eq(recurringRules.householdId, householdId),
            eq(recurringRules.id, row.recurringRuleId),
          ),
        )
        .limit(1);
      if (linked?.active === true) throw new ActionError("alreadyRecurring");
    }

    // Named after what the user sees as the row's title: the merchant (keeping
    // its seeded slug, so a sample row's rule follows the language too), else
    // the category in the current language.
    let name: string;
    let slug: string | null = null;
    if (row.merchant !== null) {
      name = row.merchant;
      slug = row.merchantSlug;
    } else {
      const [category] =
        row.categoryId === null
          ? []
          : await db
              .select({ name: categories.name, slug: categories.slug })
              .from(categories)
              .where(
                and(
                  eq(categories.householdId, householdId),
                  eq(categories.id, row.categoryId),
                ),
              )
              .limit(1);
      const nameCategory = await getCategoryNamer();
      name = category === undefined ? "—" : nameCategory(category.slug, category.name);
    }

    const today = todayISO(serverNow());
    const frequency = parsedInput.frequency;
    let nextRunOn = advanceByFrequency(row.occurredOn, frequency, 1);
    let guard = 0;
    while (compareISO(nextRunOn, today) <= 0 && guard < 1000) {
      nextRunOn = advanceByFrequency(nextRunOn, frequency, 1);
      guard += 1;
    }

    const ruleId = await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(recurringRules)
        .values({
          householdId,
          accountId: row.accountId,
          categoryId: row.categoryId,
          paidByUserId: row.paidByUserId,
          name,
          slug,
          type: row.type,
          amountMinor: row.amountMinor,
          currency: row.currency,
          note: row.note,
          noteSlug: row.noteSlug,
          frequency,
          interval: 1,
          startOn: row.occurredOn,
          nextRunOn,
          lastMaterializedOn: row.occurredOn,
          active: true,
        })
        .returning({ id: recurringRules.id });

      if (!rule) throw new ActionError("unexpected");

      await tx
        .update(transactions)
        .set({ recurringRuleId: rule.id })
        .where(
          and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)),
        );

      return rule.id;
    });

    revalidateAll();
    return { ok: true as const, ruleId, nextRunOn };
  });

/**
 * Recategorise from the detail screen or the context menu. Both halves of a
 * split move together — they are one purchase, and a split that disagrees
 * with itself about what it was would be a puzzle on the budgets screen.
 */
export const changeTransactionCategory = authAction
  .inputSchema(changeCategorySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, id: actorId } = ctx.user;
    const row = await ownedTransaction(householdId, parsedInput.id);
    if (row.type === "transfer") throw new ActionError("transferHasNoCategory");

    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.id, parsedInput.categoryId),
        ),
      )
      .limit(1);
    if (!category) throw new ActionError("categoryMissing");

    await db
      .update(transactions)
      .set({
        categoryId: category.id,
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transactions.householdId, householdId),
          row.splitGroupId === null
            ? eq(transactions.id, row.id)
            : eq(transactions.splitGroupId, row.splitGroupId),
          ne(transactions.type, "transfer"),
        ),
      );

    revalidateAll();
    return { ok: true as const };
  });

/** The live count behind the filters sheet's «Показать N операций». */
export const countTransactionsAction = authAction
  .inputSchema(transactionFilterSchema)
  .action(async ({ parsedInput, ctx }) => {
    const total = await countTransactions(ctx.user.householdId, parsedInput);
    return { count: total };
  });
