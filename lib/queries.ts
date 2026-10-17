import "server-only";
import { cache } from "react";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { getCategoryNamer } from "@/lib/category-name";
import { getSeededNamer, nameOrNull } from "@/lib/seeded-name";
import {
  accounts,
  budgets,
  categories,
  goalContributions,
  goals,
  households,
  recurringRules,
  transactions,
  transferLinks,
  users,
} from "@/db/schema";
import type {
  Account,
  AccountType,
  Category,
  Goal,
  RecurrenceFrequency,
  RecurringRule,
  TransactionSource,
  TransactionType,
} from "@/db/schema";
import { ZERO, toMinor, type Minor, type ScaledRate } from "@/lib/money";
import { enumerateBuckets, lastNMonths, type ISODate } from "@/lib/date";
import { env } from "@/lib/env";
import { parseSearchQuery } from "@/lib/search-query";
import type { TransactionFilters } from "@/lib/validations";

export const PAGE_SIZE = 25;

/**
 * A transaction points at up to three people — who it is attributed to, who
 * typed it in, and who last edited it — so the users table is joined three
 * times under distinct aliases.
 */
const payer = alias(users, "payer");
const enterer = alias(users, "enterer");
const editor = alias(users, "editor");

/**
 * Every query in this module takes a householdId and filters on it. There is no
 * unscoped read path, so a caller cannot forget to scope one.
 */

// --- accounts -------------------------------------------------------------

export interface AccountWithBalance {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly openingBalanceMinor: Minor;
  readonly balanceMinor: Minor;
  readonly transactionCount: number;
  readonly archivedAt: Date | null;
  /** Where new entries and Apple Pay taps land unless told otherwise. */
  readonly isDefault: boolean;
}

export async function listAccounts(
  householdId: string,
  options: { includeArchived?: boolean } = {},
): Promise<AccountWithBalance[]> {
  const nameSeeded = await getSeededNamer();

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      type: accounts.type,
      currency: accounts.currency,
      openingBalanceMinor: accounts.openingBalanceMinor,
      archivedAt: accounts.archivedAt,
      isDefault: accounts.isDefault,
      /*
       * A payment in another currency moves the account by what it cost in
       * the account's money, not by its face value: 2 480 CZK on a euro
       * account is −98,70 €, never −2 480 €. The base amount is that figure
       * whenever the account is in the base currency, which is every account
       * that can receive a foreign-currency row today.
       */
      movement: sql<string>`coalesce(sum(case when ${transactions.currency} = ${accounts.currency} then ${transactions.amountMinor} else ${transactions.amountBaseMinor} end), 0)`,
      transactionCount: sql<string>`count(${transactions.id})`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.householdId, householdId),
        options.includeArchived === true ? undefined : isNull(accounts.archivedAt),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));

  return rows.map((row) => ({
    id: row.id,
    name: nameSeeded(row.slug, row.name),
    type: row.type,
    currency: row.currency,
    openingBalanceMinor: row.openingBalanceMinor,
    balanceMinor: (row.openingBalanceMinor + Number(row.movement)) as Minor,
    transactionCount: Number(row.transactionCount),
    archivedAt: row.archivedAt,
    isDefault: row.isDefault,
  }));
}

export interface DefaultAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  /**
   * True when no account is flagged and this is merely the first active one —
   * the same fallback the Wallet webhook uses, so the settings screen can say
   * "nothing chosen" while still naming where a tap would land.
   */
  readonly isFallback: boolean;
}

/**
 * The household's default account: the flagged one if it is still active,
 * otherwise the first active account in display order. Null only when the
 * household has no active account at all.
 */
export async function getDefaultAccount(
  householdId: string,
): Promise<DefaultAccount | null> {
  const nameSeeded = await getSeededNamer();

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      currency: accounts.currency,
      isDefault: accounts.isDefault,
    })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)))
    .orderBy(desc(accounts.isDefault), asc(accounts.sortOrder), asc(accounts.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: nameSeeded(row.slug, row.name),
    currency: row.currency,
    isFallback: !row.isDefault,
  };
}

export async function getAccount(
  householdId: string,
  id: string,
): Promise<Account | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

// --- categories -----------------------------------------------------------

export interface CategoryWithUsage extends Category {
  readonly transactionCount: number;
}

export async function listCategories(
  householdId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CategoryWithUsage[]> {
  const nameCategory = await getCategoryNamer();

  const rows = await db
    .select({
      category: categories,
      transactionCount: sql<string>`count(${transactions.id})`,
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(categories.householdId, householdId),
        options.includeArchived === true
          ? undefined
          : isNull(categories.archivedAt),
      ),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.kind), asc(categories.name));

  return rows.map((row) => ({
    ...row.category,
    name: nameCategory(row.category.slug, row.category.name),
    transactionCount: Number(row.transactionCount),
  }));
}

/** The fallback category orphaned transactions move to. */
export async function getSystemCategory(
  householdId: string,
): Promise<Category | null> {
  const rows = await db
    .select()
    .from(categories)
    .where(
      and(eq(categories.householdId, householdId), eq(categories.isSystem, true)),
    )
    .limit(1);
  return rows[0] ?? null;
}

// --- household members ----------------------------------------------------

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly color: string;
  /** One emoji, or null to fall back to the initial on `color`. */
  readonly avatarEmoji: string | null;
}

export async function listMembers(householdId: string): Promise<Member[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.displayName,
      fallbackName: users.name,
      email: users.email,
      color: users.color,
      avatarEmoji: users.avatarEmoji,
    })
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(asc(users.email));

  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? row.fallbackName ?? row.email,
    email: row.email,
    color: row.color,
    avatarEmoji: row.avatarEmoji,
  }));
}

// --- household ------------------------------------------------------------

export interface HouseholdSummary {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
}

/** Cached per request: the search parser and several pages all want it. */
const loadHousehold = cache(async (householdId: string) => {
  const rows = await db
    .select({
      id: households.id,
      name: households.name,
      slug: households.slug,
      baseCurrency: households.baseCurrency,
    })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Throws rather than returning null: every caller holds a household id from
 * the signed-in user, so a missing row is a broken invariant, not a state a
 * screen should render.
 */
export async function getHousehold(
  householdId: string,
): Promise<HouseholdSummary> {
  const row = await loadHousehold(householdId);
  if (!row) throw new Error(`household ${householdId} not found`);
  const nameSeeded = await getSeededNamer();
  return {
    id: row.id,
    name: nameSeeded(row.slug, row.name),
    baseCurrency: row.baseCurrency,
  };
}

/**
 * How many addresses may sign in at all. The household screen shows it next to
 * the member list — membership is decided by AUTH_ALLOWED_EMAILS, not by an
 * invite flow, so this is the honest answer to "can we add someone?".
 */
export function allowedEmailCount(): number {
  return env.AUTH_ALLOWED_EMAILS.length;
}

// --- transactions ---------------------------------------------------------

export interface TransactionListItem {
  readonly id: string;
  readonly type: TransactionType;
  readonly amountMinor: Minor;
  readonly amountBaseMinor: Minor;
  readonly currency: string;
  readonly fxRateToBase: ScaledRate;
  readonly occurredOn: ISODate;
  /** Clock time when known (Apple Pay, same-day manual entry), else null. */
  readonly occurredAt: Date | null;
  readonly createdAt: Date;
  /** The row's title — "Lidl", "Obed v práci". Null shows the category. */
  readonly merchant: string | null;
  /** Free-text note. No longer the title; see migration 0010. */
  readonly note: string | null;
  readonly source: TransactionSource;
  readonly recurringRuleId: string | null;
  /** Shared with the other half of a «пополам» entry. */
  readonly splitGroupId: string | null;
  readonly accountId: string;
  readonly accountName: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly categorySlug: string | null;
  readonly categoryColor: string | null;
  readonly categoryIcon: string | null;
  readonly paidByUserId: string | null;
  readonly paidByName: string | null;
  readonly paidByColor: string | null;
  /** Who typed the row in — differs from paidBy for on-behalf-of entries. */
  readonly enteredByUserId: string | null;
  readonly enteredByName: string | null;
  readonly enteredByColor: string | null;
  /** Who last edited it, if anyone has. */
  readonly editedByName: string | null;
  readonly isTransfer: boolean;
}

export interface TransactionPage {
  readonly items: TransactionListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** `%` and `_` typed into the search box are literal, not wildcards. */
function likeTerm(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function buildTransactionWhere(
  householdId: string,
  baseCurrency: string,
  filters: TransactionFilters,
): SQL | undefined {
  const clauses: (SQL | undefined)[] = [eq(transactions.householdId, householdId)];

  if (filters.from !== undefined) {
    clauses.push(gte(transactions.occurredOn, filters.from));
  }
  if (filters.to !== undefined) {
    clauses.push(lte(transactions.occurredOn, filters.to));
  }
  if (filters.accountId !== undefined) {
    clauses.push(eq(transactions.accountId, filters.accountId));
  }

  const categoryIds = [
    ...new Set([
      ...filters.categoryIds,
      ...(filters.categoryId === undefined ? [] : [filters.categoryId]),
    ]),
  ];
  if (categoryIds.length > 0) {
    clauses.push(inArray(transactions.categoryId, categoryIds));
  }

  if (filters.type !== undefined) {
    clauses.push(eq(transactions.type, filters.type));
  }
  if (filters.paidByUserId !== undefined && filters.paidByUserId !== "") {
    clauses.push(eq(transactions.paidByUserId, filters.paidByUserId));
  }

  if (filters.q !== undefined && filters.q.trim() !== "") {
    const query = parseSearchQuery(filters.q, baseCurrency);

    if (query.text !== "") {
      const term = likeTerm(query.text);
      clauses.push(
        or(
          ilike(transactions.merchant, term),
          ilike(transactions.note, term),
          ilike(categories.name, term),
        ),
      );
    }

    // Against the magnitude in base currency: "> 50" means "big", whichever
    // direction the money went and whatever currency it was paid in.
    const magnitude = sql`abs(${transactions.amountBaseMinor})`;
    const amount = query.amount;
    if (amount !== null) {
      switch (amount.op) {
        case "gt":
          clauses.push(gt(magnitude, amount.minMinor ?? ZERO));
          break;
        case "lt":
          clauses.push(lt(magnitude, amount.maxMinor ?? ZERO));
          break;
        case "eq":
          clauses.push(eq(magnitude, amount.minMinor ?? ZERO));
          break;
        case "between":
          clauses.push(gte(magnitude, amount.minMinor ?? ZERO));
          clauses.push(lte(magnitude, amount.maxMinor ?? ZERO));
          break;
      }
    }
  }

  return and(...clauses);
}

function orderFor(sort: TransactionFilters["sort"]) {
  switch (sort) {
    case "date-asc":
      return [asc(transactions.occurredOn), asc(transactions.createdAt)];
    case "amount-desc":
      return [desc(transactions.amountBaseMinor)];
    case "amount-asc":
      return [asc(transactions.amountBaseMinor)];
    case "date-desc":
      return [desc(transactions.occurredOn), desc(transactions.createdAt)];
  }
}

/** The columns every transaction read selects, list and detail alike. */
const transactionColumns = {
  id: transactions.id,
  type: transactions.type,
  amountMinor: transactions.amountMinor,
  amountBaseMinor: transactions.amountBaseMinor,
  currency: transactions.currency,
  fxRateToBase: transactions.fxRateToBase,
  occurredOn: transactions.occurredOn,
  occurredAt: transactions.occurredAt,
  createdAt: transactions.createdAt,
  merchant: transactions.merchant,
  merchantSlug: transactions.merchantSlug,
  note: transactions.note,
  noteSlug: transactions.noteSlug,
  source: transactions.source,
  recurringRuleId: transactions.recurringRuleId,
  splitGroupId: transactions.splitGroupId,
  accountId: transactions.accountId,
  accountName: accounts.name,
  accountSlug: accounts.slug,
  categoryId: categories.id,
  categoryName: categories.name,
  categorySlug: categories.slug,
  categoryIcon: categories.icon,
  categoryColor: categories.color,
  paidByUserId: payer.id,
  paidByName: payer.displayName,
  paidByFallback: payer.name,
  paidByColor: payer.color,
  enteredByUserId: enterer.id,
  enteredByName: enterer.displayName,
  enteredByFallback: enterer.name,
  enteredByColor: enterer.color,
  editedByName: editor.displayName,
  editedByFallback: editor.name,
};

function selectTransactions() {
  return db
    .select(transactionColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(payer, eq(transactions.paidByUserId, payer.id))
    .leftJoin(enterer, eq(transactions.createdByUserId, enterer.id))
    .leftJoin(editor, eq(transactions.updatedByUserId, editor.id));
}

type TransactionRow = Awaited<ReturnType<typeof selectTransactions>>[number];

async function getTransactionMapper(): Promise<
  (row: TransactionRow) => TransactionListItem
> {
  const [nameCategory, nameSeeded] = await Promise.all([
    getCategoryNamer(),
    getSeededNamer(),
  ]);

  return (row) => ({
    id: row.id,
    type: row.type,
    amountMinor: row.amountMinor,
    amountBaseMinor: row.amountBaseMinor,
    currency: row.currency,
    fxRateToBase: row.fxRateToBase,
    occurredOn: row.occurredOn,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    merchant: nameOrNull(nameSeeded, row.merchantSlug, row.merchant),
    note: nameOrNull(nameSeeded, row.noteSlug, row.note),
    source: row.source,
    recurringRuleId: row.recurringRuleId,
    splitGroupId: row.splitGroupId,
    accountId: row.accountId,
    accountName: nameSeeded(row.accountSlug, row.accountName),
    categoryId: row.categoryId,
    categoryName:
      row.categoryName === null
        ? null
        : nameCategory(row.categorySlug, row.categoryName),
    categorySlug: row.categorySlug,
    categoryColor: row.categoryColor,
    categoryIcon: row.categoryIcon,
    paidByUserId: row.paidByUserId,
    paidByName: row.paidByName ?? row.paidByFallback,
    paidByColor: row.paidByColor,
    enteredByUserId: row.enteredByUserId,
    enteredByName: row.enteredByName ?? row.enteredByFallback,
    enteredByColor: row.enteredByColor,
    editedByName: row.editedByName ?? row.editedByFallback,
    isTransfer: row.type === "transfer",
  });
}

export async function listTransactions(
  householdId: string,
  filters: TransactionFilters,
): Promise<TransactionPage> {
  const { baseCurrency } = await getHousehold(householdId);
  const where = buildTransactionWhere(householdId, baseCurrency, filters);
  const offset = (filters.page - 1) * PAGE_SIZE;

  const [toItem, rows, total] = await Promise.all([
    getTransactionMapper(),
    selectTransactions()
      .where(where)
      .orderBy(...orderFor(filters.sort))
      .limit(PAGE_SIZE)
      .offset(offset),
    countWhere(where),
  ]);

  return {
    items: rows.map(toItem),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

async function countWhere(where: SQL | undefined): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where);
  return rows[0]?.value ?? 0;
}

/**
 * How many rows a filter set matches, without loading them — the filters
 * sheet's live «Показать N операций» button. `page` and `sort` are ignored.
 */
export async function countTransactions(
  householdId: string,
  filters: TransactionFilters,
): Promise<number> {
  const { baseCurrency } = await getHousehold(householdId);
  return countWhere(buildTransactionWhere(householdId, baseCurrency, filters));
}

export interface TransactionTotals {
  readonly incomeMinor: Minor;
  /** Positive magnitude. */
  readonly expenseMinor: Minor;
  /** income − expense. */
  readonly netMinor: Minor;
}

/**
 * Income, spending and net over exactly the rows a filter set shows — the
 * summary above the transactions list. Same WHERE as the list and the count,
 * search and amount expressions included, so the three can never disagree.
 * Base currency throughout; transfers are excluded, as in lib/stats.ts.
 */
export async function sumTransactions(
  householdId: string,
  filters: TransactionFilters,
): Promise<TransactionTotals> {
  const { baseCurrency } = await getHousehold(householdId);
  const where = buildTransactionWhere(householdId, baseCurrency, filters);

  const [row] = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountBaseMinor} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then abs(${transactions.amountBaseMinor}) else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where);

  const incomeMinor = toMinor(Number(row?.income ?? 0));
  const expenseMinor = toMinor(Number(row?.expense ?? 0));
  return {
    incomeMinor,
    expenseMinor,
    netMinor: toMinor(incomeMinor - expenseMinor),
  };
}

export interface TransactionDetail extends TransactionListItem {
  /** The rule that made this row, or that was made from it. */
  readonly recurringRule: {
    readonly id: string;
    readonly name: string;
    readonly frequency: RecurrenceFrequency;
    readonly interval: number;
    readonly nextRunOn: ISODate;
    readonly active: boolean;
  } | null;
  /** The other half of a «пополам» entry. */
  readonly splitPeer: {
    readonly id: string;
    readonly paidByName: string | null;
    readonly amountMinor: Minor;
  } | null;
  /** For a transfer leg: the account on the other side. */
  readonly transferPeerAccountName: string | null;
}

export async function getTransactionDetail(
  householdId: string,
  id: string,
): Promise<TransactionDetail | null> {
  const [toItem, nameSeeded, rows] = await Promise.all([
    getTransactionMapper(),
    getSeededNamer(),
    selectTransactions()
      .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)))
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) return null;
  const item = toItem(row);

  const [ruleRows, peerRows, transferRows] = await Promise.all([
    item.recurringRuleId === null
      ? []
      : db
          .select({
            id: recurringRules.id,
            name: recurringRules.name,
            slug: recurringRules.slug,
            frequency: recurringRules.frequency,
            interval: recurringRules.interval,
            nextRunOn: recurringRules.nextRunOn,
            active: recurringRules.active,
          })
          .from(recurringRules)
          .where(
            and(
              eq(recurringRules.householdId, householdId),
              eq(recurringRules.id, item.recurringRuleId),
            ),
          )
          .limit(1),
    item.splitGroupId === null
      ? []
      : db
          .select({
            id: transactions.id,
            amountMinor: transactions.amountMinor,
            paidByName: payer.displayName,
            paidByFallback: payer.name,
          })
          .from(transactions)
          .leftJoin(payer, eq(transactions.paidByUserId, payer.id))
          .where(
            and(
              eq(transactions.householdId, householdId),
              eq(transactions.splitGroupId, item.splitGroupId),
              ne(transactions.id, id),
            ),
          )
          .limit(1),
    !item.isTransfer
      ? []
      : db
          .select({ name: accounts.name, slug: accounts.slug })
          .from(transferLinks)
          .innerJoin(
            transactions,
            or(
              and(
                eq(transferLinks.fromTransactionId, id),
                eq(transactions.id, transferLinks.toTransactionId),
              ),
              and(
                eq(transferLinks.toTransactionId, id),
                eq(transactions.id, transferLinks.fromTransactionId),
              ),
            ),
          )
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          .where(eq(transactions.householdId, householdId))
          .limit(1),
  ]);

  const rule = ruleRows[0];
  const peer = peerRows[0];
  const transferPeer = transferRows[0];

  return {
    ...item,
    recurringRule:
      rule === undefined
        ? null
        : {
            id: rule.id,
            name: nameSeeded(rule.slug, rule.name),
            frequency: rule.frequency,
            interval: rule.interval,
            nextRunOn: rule.nextRunOn,
            active: rule.active,
          },
    splitPeer:
      peer === undefined
        ? null
        : {
            id: peer.id,
            paidByName: peer.paidByName ?? peer.paidByFallback,
            amountMinor: peer.amountMinor,
          },
    transferPeerAccountName:
      transferPeer === undefined
        ? null
        : nameSeeded(transferPeer.slug, transferPeer.name),
  };
}

export interface MerchantHistory {
  /** Expenses at this merchant within the window. */
  readonly count: number;
  /** Per visit, in base currency; zero when there were none. */
  readonly averageMinor: Minor;
  readonly totalMinor: Minor;
  /** Exactly `months` entries, oldest first, zero-filled. */
  readonly months: readonly {
    readonly monthStart: ISODate;
    readonly totalMinor: Minor;
  }[];
}

/**
 * "6 раз за полгода, в среднем 23 €" plus the bars under it, for the detail
 * screen. Expenses only — a refund from the same shop is not a visit — and in
 * base currency so a trip abroad still adds up. Matching ignores case, since
 * Apple Pay and a hand-typed entry rarely agree on capitals; the index on
 * lower(merchant) is what keeps that cheap.
 *
 * The window is whole calendar months ending with the one `now` is in.
 */
export async function getMerchantHistory(
  householdId: string,
  merchant: string,
  now: Date,
  months = 6,
): Promise<MerchantHistory> {
  const span = Math.max(1, Math.trunc(months));
  const range = lastNMonths(now, span);
  const buckets = enumerateBuckets(range, "month");
  const wanted = merchant.trim().toLowerCase();

  const monthExpr = sql`date_trunc('month', ${transactions.occurredOn}::date)`;
  const rows =
    wanted === ""
      ? []
      : await db
          .select({
            month: sql<string>`to_char(${monthExpr}, 'YYYY-MM-DD')`,
            visits: sql<string>`count(*)`,
            total: sql<string>`coalesce(sum(abs(${transactions.amountBaseMinor})), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, householdId),
              eq(transactions.type, "expense"),
              sql`lower(${transactions.merchant}) = ${wanted}`,
              gte(transactions.occurredOn, range.from),
              lte(transactions.occurredOn, range.to),
            ),
          )
          .groupBy(monthExpr);

  const byMonth = new Map(rows.map((row) => [row.month, row]));
  let visits = 0;
  let total = 0;
  for (const row of rows) {
    visits += Number(row.visits);
    total += Number(row.total);
  }

  return {
    count: visits,
    totalMinor: toMinor(total),
    averageMinor: visits === 0 ? ZERO : toMinor(Math.round(total / visits)),
    months: buckets.map((monthStart) => ({
      monthStart,
      totalMinor: toMinor(Number(byMonth.get(monthStart)?.total ?? 0)),
    })),
  };
}

// --- budgets --------------------------------------------------------------

export interface BudgetWithSpend {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categorySlug: string | null;
  readonly categoryIcon: string;
  readonly categoryColor: string;
  readonly periodStart: ISODate;
  readonly limitMinor: Minor;
  readonly currency: string;
  readonly spentMinor: Minor;
  /**
   * The category has an active recurring rule — rent, a phone plan. Spending
   * the whole limit on one of these is the bill being paid, not an overrun,
   * so the UI says «оплачено» instead of turning red.
   */
  readonly isFixed: boolean;
}

export async function listBudgets(
  householdId: string,
  periodStart: ISODate,
  periodEnd: ISODate,
): Promise<BudgetWithSpend[]> {
  const nameCategory = await getCategoryNamer();

  const rows = await db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      periodStart: budgets.periodStart,
      limitMinor: budgets.limitMinor,
      currency: budgets.currency,
      spent: sql<string>`coalesce((
        select sum(abs(t.amount_base_minor))
        from ${transactions} t
        where t.household_id = ${householdId}
          and t.category_id = ${budgets.categoryId}
          and t.type = 'expense'
          and t.occurred_on >= ${periodStart}
          and t.occurred_on <= ${periodEnd}
      ), 0)`,
      isFixed: sql<boolean>`exists (
        select 1
        from ${recurringRules} r
        where r.household_id = ${householdId}
          and r.category_id = ${budgets.categoryId}
          and r.active
      )`,
    })
    .from(budgets)
    .innerJoin(categories, eq(budgets.categoryId, categories.id))
    .where(
      and(
        eq(budgets.householdId, householdId),
        eq(budgets.periodStart, periodStart),
      ),
    )
    .orderBy(asc(categories.name));

  return rows.map((row) => ({
    id: row.id,
    categoryId: row.categoryId,
    categoryName: nameCategory(row.categorySlug, row.categoryName),
    categorySlug: row.categorySlug,
    categoryIcon: row.categoryIcon,
    categoryColor: row.categoryColor,
    periodStart: row.periodStart,
    limitMinor: row.limitMinor,
    currency: row.currency,
    spentMinor: Number(row.spent) as Minor,
    isFixed: row.isFixed,
  }));
}

// --- recurring ------------------------------------------------------------

export interface RecurringWithNames extends RecurringRule {
  readonly accountName: string;
  readonly categoryName: string | null;
  readonly categorySlug: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
}

export async function listRecurring(
  householdId: string,
): Promise<RecurringWithNames[]> {
  const [nameCategory, nameSeeded] = await Promise.all([
    getCategoryNamer(),
    getSeededNamer(),
  ]);

  const rows = await db
    .select({
      rule: recurringRules,
      accountName: accounts.name,
      categoryName: categories.name,
      categorySlug: categories.slug,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
    })
    .from(recurringRules)
    .innerJoin(accounts, eq(recurringRules.accountId, accounts.id))
    .leftJoin(categories, eq(recurringRules.categoryId, categories.id))
    .where(eq(recurringRules.householdId, householdId))
    .orderBy(desc(recurringRules.active), asc(recurringRules.nextRunOn));

  return rows.map((row) => ({
    ...row.rule,
    name: nameSeeded(row.rule.slug, row.rule.name),
    note: nameOrNull(nameSeeded, row.rule.noteSlug, row.rule.note),
    accountName: row.accountName,
    categorySlug: row.categorySlug,
    categoryIcon: row.categoryIcon,
    categoryColor: row.categoryColor,
    categoryName:
      row.categoryName === null
        ? null
        : nameCategory(row.categorySlug, row.categoryName),
  }));
}

// --- goals ----------------------------------------------------------------

export interface GoalWithProgress extends Goal {
  readonly savedMinor: Minor;
  readonly contributionCount: number;
  readonly firstContributionOn: ISODate | null;
  readonly lastContributionOn: ISODate | null;
  /**
   * Per-day contribution totals, oldest first. What `projectGoal` needs to
   * find the day the target was reached — the sum alone cannot say when.
   */
  readonly contributions: readonly {
    readonly occurredOn: ISODate;
    readonly amountMinor: Minor;
  }[];
}

export async function listGoals(
  householdId: string,
): Promise<GoalWithProgress[]> {
  const nameSeeded = await getSeededNamer();

  const rows = await db
    .select({
      goal: goals,
      saved: sql<string>`coalesce(sum(${goalContributions.amountMinor}), 0)`,
      contributionCount: sql<string>`count(${goalContributions.id})`,
      firstOn: sql<string | null>`min(${goalContributions.occurredOn})`,
      lastOn: sql<string | null>`max(${goalContributions.occurredOn})`,
    })
    .from(goals)
    .leftJoin(goalContributions, eq(goalContributions.goalId, goals.id))
    .where(and(eq(goals.householdId, householdId), isNull(goals.archivedAt)))
    .groupBy(goals.id)
    .orderBy(asc(goals.targetDate), asc(goals.name));

  const timeline = await listGoalContributionTotals(householdId);

  return rows.map((row) => ({
    ...row.goal,
    name: nameSeeded(row.goal.slug, row.goal.name),
    savedMinor: (Number(row.saved) || ZERO) as Minor,
    contributionCount: Number(row.contributionCount),
    firstContributionOn: row.firstOn,
    lastContributionOn: row.lastOn,
    contributions: timeline.get(row.goal.id) ?? [],
  }));
}

/**
 * Contributions summed per goal per day, oldest first, for every active goal
 * in the household. One grouped query rather than one per goal.
 */
export async function listGoalContributionTotals(
  householdId: string,
): Promise<Map<string, { occurredOn: ISODate; amountMinor: Minor }[]>> {
  const rows = await db
    .select({
      goalId: goalContributions.goalId,
      occurredOn: goalContributions.occurredOn,
      total: sql<string>`sum(${goalContributions.amountMinor})`,
    })
    .from(goalContributions)
    .innerJoin(goals, eq(goalContributions.goalId, goals.id))
    .where(and(eq(goals.householdId, householdId), isNull(goals.archivedAt)))
    .groupBy(goalContributions.goalId, goalContributions.occurredOn)
    .orderBy(asc(goalContributions.occurredOn));

  const byGoal = new Map<string, { occurredOn: ISODate; amountMinor: Minor }[]>();
  for (const row of rows) {
    const list = byGoal.get(row.goalId) ?? [];
    list.push({ occurredOn: row.occurredOn, amountMinor: toMinor(Number(row.total)) });
    byGoal.set(row.goalId, list);
  }
  return byGoal;
}
