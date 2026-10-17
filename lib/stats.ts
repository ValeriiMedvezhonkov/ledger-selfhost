import "server-only";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { getCategoryNamer } from "@/lib/category-name";
import { getSeededNamer, nameOrNull } from "@/lib/seeded-name";
import { accounts, categories, transactions, users } from "@/db/schema";
import { ZERO, type Minor } from "@/lib/money";
import {
  enumerateBuckets,
  type DateRange,
  type Granularity,
  type ISODate,
} from "@/lib/date";
import type { StatRow } from "@/lib/stats-insights";

/**
 * Every dashboard number is computed here, in SQL, over `amount_base_minor` so
 * mixed-currency households still add up. Transfers are excluded from income
 * and expense totals throughout — moving your own money between accounts is not
 * spending, and counting it would inflate both sides.
 */

const NOT_TRANSFER = ne(transactions.type, "transfer");

function inRange(
  householdId: string,
  range: DateRange,
  paidByUserId?: string,
) {
  return and(
    eq(transactions.householdId, householdId),
    gte(transactions.occurredOn, range.from),
    lte(transactions.occurredOn, range.to),
    // One person's view of the same numbers — undefined means the household.
    paidByUserId === undefined
      ? undefined
      : eq(transactions.paidByUserId, paidByUserId),
  );
}

// --- KPIs -----------------------------------------------------------------

export interface PeriodTotals {
  readonly incomeMinor: Minor;
  readonly expenseMinor: Minor;
  readonly netMinor: Minor;
}

export async function getPeriodTotals(
  householdId: string,
  range: DateRange,
  paidByUserId?: string,
): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountBaseMinor} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then abs(${transactions.amountBaseMinor}) else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(inRange(householdId, range, paidByUserId), NOT_TRANSFER));

  const incomeMinor = Number(row?.income ?? 0) as Minor;
  const expenseMinor = Number(row?.expense ?? 0) as Minor;

  return {
    incomeMinor,
    expenseMinor,
    netMinor: (incomeMinor - expenseMinor) as Minor,
  };
}

/** Total balance across accounts denominated in the base currency. */
export async function getTotalBalance(
  householdId: string,
  baseCurrency: string,
): Promise<Minor> {
  const [row] = await db
    .select({
      value: sql<string>`
        coalesce(sum(${accounts.openingBalanceMinor}), 0)
        + coalesce((
            -- Foreign-currency rows count at their converted amount, as in
            -- listAccounts: the balance is in the account's money.
            select sum(case when t.currency = a.currency then t.amount_minor else t.amount_base_minor end)
            from ${transactions} t
            join ${accounts} a on a.id = t.account_id
            where a.household_id = ${householdId}
              and a.archived_at is null
              and a.currency = ${baseCurrency}
          ), 0)`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.currency, baseCurrency),
        sql`${accounts.archivedAt} is null`,
      ),
    );

  return (Number(row?.value ?? 0) || ZERO) as Minor;
}

// --- time series ----------------------------------------------------------

export interface SpendingBucket {
  readonly bucket: ISODate;
  readonly expenseMinor: Minor;
  readonly incomeMinor: Minor;
}

const TRUNC: Readonly<Record<Granularity, string>> = {
  day: "day",
  week: "week",
  month: "month",
};

export async function getSpendingOverTime(
  householdId: string,
  range: DateRange,
  granularity: Granularity,
  paidByUserId?: string,
): Promise<SpendingBucket[]> {
  // The unit is inlined rather than bound: a bind parameter makes the SELECT
  // and GROUP BY expressions non-identical to the planner, which fails with
  // "must appear in the GROUP BY clause". `unit` comes from the TRUNC map, so
  // it is a fixed literal and never user input.
  const unit = sql.raw(`'${TRUNC[granularity]}'`);
  const bucketExpr = sql`date_trunc(${unit}, ${transactions.occurredOn}::date)`;

  const rows = await db
    .select({
      bucket: sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD')`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then abs(${transactions.amountBaseMinor}) else 0 end), 0)`,
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountBaseMinor} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(inRange(householdId, range, paidByUserId), NOT_TRANSFER))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr);

  const found = new Map(rows.map((row) => [row.bucket, row]));

  // Empty buckets must render as zero, not vanish — a gap in a time series
  // reads as "no data" when it actually means "spent nothing".
  return enumerateBuckets(range, granularity).map((bucket) => {
    const row = found.get(bucket);
    return {
      bucket,
      expenseMinor: (Number(row?.expense ?? 0) || ZERO) as Minor,
      incomeMinor: (Number(row?.income ?? 0) || ZERO) as Minor,
    };
  });
}

// --- category breakdown ---------------------------------------------------

export interface CategorySlice {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string;
  readonly totalMinor: Minor;
  readonly share: number;
}

export async function getCategoryBreakdown(
  householdId: string,
  range: DateRange,
  paidByUserId?: string,
): Promise<CategorySlice[]> {
  const nameCategory = await getCategoryNamer();

  const rows = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      slug: categories.slug,
      color: categories.color,
      total: sql<string>`coalesce(sum(abs(${transactions.amountBaseMinor})), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(inRange(householdId, range, paidByUserId), eq(transactions.type, "expense")),
    )
    .groupBy(categories.id, categories.name, categories.slug, categories.color)
    .orderBy(desc(sql`sum(abs(${transactions.amountBaseMinor}))`));

  const totals = rows.map((row) => Number(row.total));
  const grand = totals.reduce((sum, value) => sum + value, 0);

  return rows.map((row, index) => ({
    categoryId: row.categoryId,
    name:
      row.name === null
        ? nameCategory("uncategorised", "Uncategorised")
        : nameCategory(row.slug, row.name),
    color: row.color ?? "#94a3b8",
    totalMinor: (totals[index] ?? 0) as Minor,
    share: grand === 0 ? 0 : ((totals[index] ?? 0) / grand) * 100,
  }));
}

// --- income vs expense by month ------------------------------------------

export interface MonthlyComparison {
  readonly month: ISODate;
  readonly incomeMinor: Minor;
  readonly expenseMinor: Minor;
}

export async function getIncomeVsExpense(
  householdId: string,
  range: DateRange,
  paidByUserId?: string,
): Promise<MonthlyComparison[]> {
  const buckets = await getSpendingOverTime(householdId, range, "month", paidByUserId);
  return buckets.map((bucket) => ({
    month: bucket.bucket,
    incomeMinor: bucket.incomeMinor,
    expenseMinor: bucket.expenseMinor,
  }));
}

// --- who spent what -------------------------------------------------------

export interface MemberSpend {
  readonly userId: string | null;
  readonly name: string;
  readonly color: string;
  readonly totalMinor: Minor;
  readonly share: number;
}

export async function getSpendByMember(
  householdId: string,
  range: DateRange,
): Promise<MemberSpend[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      fallbackName: users.name,
      email: users.email,
      color: users.color,
      total: sql<string>`coalesce(sum(abs(${transactions.amountBaseMinor})), 0)`,
    })
    .from(transactions)
    .leftJoin(users, eq(transactions.paidByUserId, users.id))
    .where(and(inRange(householdId, range), eq(transactions.type, "expense")))
    .groupBy(users.id, users.displayName, users.name, users.email, users.color)
    .orderBy(desc(sql`sum(abs(${transactions.amountBaseMinor}))`));

  const totals = rows.map((row) => Number(row.total));
  const grand = totals.reduce((sum, value) => sum + value, 0);

  return rows.map((row, index) => ({
    userId: row.userId,
    name: row.displayName ?? row.fallbackName ?? row.email ?? "Unassigned",
    color: row.color ?? "#94a3b8",
    totalMinor: (totals[index] ?? 0) as Minor,
    share: grand === 0 ? 0 : ((totals[index] ?? 0) / grand) * 100,
  }));
}

// --- net worth ------------------------------------------------------------

export interface NetWorthPoint {
  readonly month: ISODate;
  readonly balanceMinor: Minor;
}

/**
 * Month-end balance over time. The per-month movement is summed in SQL; the
 * running total is a fold over that small result set, which is cheaper than a
 * window function over every transaction and easier to read.
 */
export async function getNetWorthSeries(
  householdId: string,
  range: DateRange,
  baseCurrency: string,
): Promise<NetWorthPoint[]> {
  const [opening] = await db
    .select({
      value: sql<string>`coalesce(sum(${accounts.openingBalanceMinor}), 0)`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.currency, baseCurrency),
      ),
    );

  const [before] = await db
    .select({
      // Base-currency accounts only, so the base amount is the account's
      // own: a CZK payment counts at what it cost in euros.
      value: sql<string>`coalesce(sum(${transactions.amountBaseMinor}), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(accounts.currency, baseCurrency),
        sql`${transactions.occurredOn} < ${range.from}`,
      ),
    );

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${transactions.occurredOn}::date), 'YYYY-MM-DD')`,
      movement: sql<string>`coalesce(sum(${transactions.amountBaseMinor}), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(accounts.currency, baseCurrency),
        gte(transactions.occurredOn, range.from),
        lte(transactions.occurredOn, range.to),
      ),
    )
    .groupBy(sql`date_trunc('month', ${transactions.occurredOn}::date)`)
    .orderBy(sql`date_trunc('month', ${transactions.occurredOn}::date)`);

  const movementByMonth = new Map(
    rows.map((row) => [row.month, Number(row.movement)]),
  );

  let running = Number(opening?.value ?? 0) + Number(before?.value ?? 0);

  return enumerateBuckets(range, "month").map((month) => {
    running += movementByMonth.get(month) ?? 0;
    return { month, balanceMinor: running as Minor };
  });
}

// --- recent ---------------------------------------------------------------

export interface RecentItem {
  readonly id: string;
  /** The row's title; `note` is free text since migration 0010. */
  readonly merchant: string | null;
  readonly note: string | null;
  readonly categoryName: string | null;
  readonly categorySlug: string | null;
  /** The category's own emoji, so the row can wear the same tile as the list. */
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  /** Who recorded it — the row shows their dot, as on the transactions list. */
  readonly paidByUserId: string | null;
  readonly amountMinor: Minor;
  readonly currency: string;
  readonly occurredOn: ISODate;
  readonly type: "income" | "expense" | "transfer";
}

export async function getRecentTransactions(
  householdId: string,
  limit = 10,
  paidByUserId?: string,
): Promise<RecentItem[]> {
  const [nameCategory, nameSeeded] = await Promise.all([
    getCategoryNamer(),
    getSeededNamer(),
  ]);

  const rows = await db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      merchantSlug: transactions.merchantSlug,
      note: transactions.note,
      noteSlug: transactions.noteSlug,
      categoryName: categories.name,
      categorySlug: categories.slug,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      paidByUserId: transactions.paidByUserId,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      type: transactions.type,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.householdId, householdId),
        paidByUserId === undefined
          ? undefined
          : eq(transactions.paidByUserId, paidByUserId),
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(limit);

  return rows.map(({ merchantSlug, noteSlug, ...row }) => ({
    ...row,
    merchant: nameOrNull(nameSeeded, merchantSlug, row.merchant),
    note: nameOrNull(nameSeeded, noteSlug, row.note),
    categoryName:
      row.categoryName === null
        ? null
        : nameCategory(row.categorySlug, row.categoryName),
  }));
}

// --- Статистика -----------------------------------------------------------

/**
 * The rows Статистика folds over (lib/stats-insights): income and expenses
 * in `range`, narrowed to one person and one account when asked. Category,
 * kind and recurring filters are applied in the fold, because the history
 * charts need the rows those filters would drop (income for the savings
 * rate, rent for «постоянные»).
 */
export async function getStatRows(
  householdId: string,
  range: DateRange,
  options: { readonly memberId: string | null; readonly accountId: string | null },
): Promise<StatRow[]> {
  const nameSeeded = await getSeededNamer();
  const rows = await db
    .select({
      on: transactions.occurredOn,
      at: transactions.occurredAt,
      type: transactions.type,
      amount: transactions.amountBaseMinor,
      categoryId: transactions.categoryId,
      merchant: transactions.merchant,
      merchantSlug: transactions.merchantSlug,
      memberId: transactions.paidByUserId,
      recurringRuleId: transactions.recurringRuleId,
    })
    .from(transactions)
    .where(
      and(
        inRange(householdId, range, options.memberId ?? undefined),
        NOT_TRANSFER,
        options.accountId === null
          ? undefined
          : eq(transactions.accountId, options.accountId),
      ),
    );

  return rows.map((row) => ({
    on: row.on,
    at: row.at === null ? null : row.at.toISOString(),
    type: row.type === "income" ? "income" : "expense",
    amount: Math.abs(Number(row.amount)),
    categoryId: row.categoryId,
    merchant: nameOrNull(nameSeeded, row.merchantSlug, row.merchant),
    memberId: row.memberId,
    fixed: row.recurringRuleId !== null,
  }));
}

/** The household's first income or expense — where averages may start. */
export async function getFirstDataDate(
  householdId: string,
): Promise<ISODate | null> {
  const [row] = await db
    .select({ on: sql<string | null>`min(${transactions.occurredOn})` })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), NOT_TRANSFER));
  return row?.on ?? null;
}
