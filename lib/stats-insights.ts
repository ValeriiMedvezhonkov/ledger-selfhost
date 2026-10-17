import { addMonths, endOfMonth, startOfMonth } from "date-fns";
import { toISODate, type DateRange, type ISODate } from "@/lib/date";
import type { Minor } from "@/lib/money";
import {
  AVERAGE_OF,
  firstDays,
  rangeDays,
  shiftStatsPeriod,
  statsPeriod,
  type StatsFilters,
} from "@/lib/stats-filters";

/**
 * Everything Статистика shows (board L15), worked out from one set of rows.
 *
 * The page loads the household's income and expense rows once — for the
 * period, the periods it is compared with and the six months the history
 * charts span — and every figure is a fold over them here. A household has
 * hundreds of rows a month, not millions, and one pure function is easier to
 * get right (and to test) than a dozen GROUP BYs that must all agree on what
 * "the same day last month" means.
 */

export interface StatRow {
  readonly on: ISODate;
  /** The clock time when it is known (Apple Pay taps, same-day entries). */
  readonly at: string | null;
  readonly type: "income" | "expense";
  /** Base-currency amount, always positive. */
  readonly amount: number;
  readonly categoryId: string | null;
  readonly merchant: string | null;
  readonly memberId: string | null;
  /** Made by a recurring rule: rent, subscriptions. */
  readonly fixed: boolean;
}

export interface StatBudget {
  readonly categoryId: string;
  readonly limitMinor: Minor;
  readonly isFixed: boolean;
}

export interface CategoryStat {
  readonly categoryId: string | null;
  readonly totalMinor: Minor;
  readonly count: number;
  /** 0–1 of the period's flow. */
  readonly share: number;
  /** The comparison's amount by the same day; null with nothing to compare. */
  readonly compareMinor: Minor | null;
  /** Every row came from a recurring rule («1 платёж»). */
  readonly allFixed: boolean;
}

export interface MerchantStat {
  readonly name: string;
  readonly categoryId: string | null;
  readonly totalMinor: Minor;
  readonly count: number;
  readonly fixed: boolean;
}

export interface MonthSplit {
  readonly month: ISODate;
  readonly fixedMinor: Minor;
  readonly flexibleMinor: Minor;
  /** The rest of an unfinished month at its pace so far (the pale cap). */
  readonly projectedMinor: Minor;
}

export interface MemberMonth {
  readonly month: ISODate;
  readonly byMember: Readonly<Record<string, Minor>>;
}

export interface SavingsMonth {
  readonly month: ISODate;
  readonly incomeMinor: Minor;
  readonly expenseMinor: Minor;
  readonly complete: boolean;
}

export interface StatsInsights {
  readonly period: DateRange;
  readonly totalDays: number;
  /** Days of the period that have happened (all of them once it is over). */
  readonly elapsedDays: number;
  readonly inProgress: boolean;
  /** The periods compared against; empty when there is no earlier data. */
  readonly compareRanges: readonly DateRange[];

  readonly summary: {
    readonly totalMinor: Minor;
    readonly compareMinor: Minor | null;
    /** total / compare − 1. */
    readonly change: number | null;
    /** Where the period ends at this pace; null once it is over. */
    readonly projectionMinor: Minor | null;
    readonly budgetMinor: Minor | null;
    /** Running total by day, for the days so far. */
    readonly current: readonly number[];
    /** The comparison's running total by day, for the whole period. */
    readonly compare: readonly number[];
  };
  readonly categories: readonly CategoryStat[];
  readonly merchants: readonly MerchantStat[];
  readonly when: {
    /** One cell per day (per month for a year), in order. */
    readonly cells: readonly { readonly key: ISODate; readonly totalMinor: Minor }[];
    /** Monday first. */
    readonly weekdays: readonly number[];
    /** [instant ms, amount] — bucketed by hour on the device, in its time zone. */
    readonly timed: readonly (readonly [number, number])[];
  };
  readonly months: readonly ISODate[];
  readonly fixedFlexible: {
    readonly months: readonly MonthSplit[];
    readonly fixedAverageMinor: Minor;
    readonly flexibleAverageMinor: Minor;
    readonly fixedShare: number;
  };
  readonly members: {
    readonly totals: readonly { readonly memberId: string; readonly totalMinor: Minor }[];
    readonly months: readonly MemberMonth[];
    /** Shares over the six months with recurring payments left out. */
    readonly flexibleShares: readonly { readonly memberId: string; readonly share: number }[];
  };
  readonly savings: {
    readonly months: readonly SavingsMonth[];
    /** Share of income kept, over the finished months. */
    readonly rate: number | null;
    readonly savedMinor: Minor;
  };
}

const minor = (value: number) => Math.round(value) as Minor;

function within(on: ISODate, range: DateRange): boolean {
  return on >= range.from && on <= range.to;
}

function dayIndex(on: ISODate, range: DateRange): number {
  return rangeDays({ from: range.from, to: on }) - 1;
}

function sum(rows: readonly StatRow[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The six months the history charts cover, ending with the period's month. */
export function historyMonths(filters: StatsFilters, today: ISODate): DateRange[] {
  const period = statsPeriod(filters.span, filters.at);
  const last = period.to < today ? period.to : today;
  const end = new Date(`${last}T12:00:00`);
  return Array.from({ length: 6 }, (_, index) => {
    const month = addMonths(startOfMonth(end), index - 5);
    return { from: toISODate(month), to: toISODate(endOfMonth(month)) };
  });
}

/** Every date the insights read: what the page has to load. */
export function statsWindow(filters: StatsFilters, today: ISODate): DateRange {
  const period = statsPeriod(filters.span, filters.at);
  const back = filters.compare === "average" ? AVERAGE_OF : 1;
  const earliest = shiftStatsPeriod(filters.span, filters.at, -back).from;
  const history = historyMonths(filters, today)[0]?.from ?? period.from;
  return { from: earliest < history ? earliest : history, to: period.to };
}

export function computeStatsInsights({
  rows: loaded,
  filters,
  today,
  budgets,
  firstDataOn,
}: {
  /** Income and expense rows in `statsWindow`, already narrowed by member and account. */
  readonly rows: readonly StatRow[];
  readonly filters: StatsFilters;
  readonly today: ISODate;
  readonly budgets: readonly StatBudget[];
  /** The household's first row: earlier periods are not averaged in as zeros. */
  readonly firstDataOn: ISODate | null;
}): StatsInsights {
  // A row dated ahead (a booked payment) has not happened yet.
  const rows = loaded.filter((row) => row.on <= today);
  const period = statsPeriod(filters.span, filters.at);
  const totalDays = rangeDays(period);
  const inProgress = today >= period.from && today < period.to;
  const elapsedDays = inProgress ? dayIndex(today, period) + 1 : totalDays;

  const categorySet = new Set(filters.categoryIds);
  const inCategories = (row: StatRow) =>
    categorySet.size === 0 || (row.categoryId !== null && categorySet.has(row.categoryId));
  /** What the flow charts count: the kind, the categories, maybe no fixed rows. */
  const isFlow = (row: StatRow) =>
    (filters.kind === "all" || row.type === filters.kind) &&
    inCategories(row) &&
    !(filters.withoutFixed && row.fixed);

  const flows = rows.filter(isFlow);
  const current = flows.filter((row) => within(row.on, period));

  /* ----------------------------------------------------- comparison */

  const back = filters.compare === "average" ? AVERAGE_OF : 1;
  const compareRanges = Array.from({ length: back }, (_, index) =>
    shiftStatsPeriod(filters.span, filters.at, -(index + 1)),
  ).filter((range) => firstDataOn !== null && range.to >= firstDataOn);
  // «к тому же дню»: an unfinished period is held against the same stretch.
  const compareCuts = compareRanges.map((range) => firstDays(range, elapsedDays));
  const compareTotalOf = (pick: (row: StatRow) => boolean) =>
    average(compareCuts.map((cut) => sum(flows.filter((row) => within(row.on, cut) && pick(row)))));

  /* -------------------------------------------------------- summary */

  const totalMinor = sum(current);
  const compareTotal = compareTotalOf(() => true);

  const runningTotal = (range: DateRange, length: number) => {
    const daily = Array.from({ length }, () => 0);
    for (const row of flows) {
      if (!within(row.on, range)) continue;
      const index = dayIndex(row.on, range);
      if (index < length) daily[index] = (daily[index] ?? 0) + row.amount;
    }
    let running = 0;
    return daily.map((value) => (running += value));
  };
  const currentCurve = runningTotal({ from: period.from, to: today < period.to ? today : period.to }, elapsedDays);
  const compareCurves = compareRanges.map((range) => {
    const curve = runningTotal(range, rangeDays(range));
    // A shorter month holds its total for the days it does not have.
    return Array.from({ length: totalDays }, (_, index) => curve[Math.min(index, curve.length - 1)] ?? 0);
  });
  const compareCurve =
    compareCurves.length === 0
      ? []
      : Array.from({ length: totalDays }, (_, index) =>
          compareCurves.reduce((total, curve) => total + (curve[index] ?? 0), 0) / compareCurves.length,
        );

  // Recurring payments land once, so only the rest is run forward.
  const fixedSoFar = sum(current.filter((row) => row.fixed));
  const projection = inProgress
    ? fixedSoFar + ((totalMinor - fixedSoFar) * totalDays) / Math.max(1, elapsedDays)
    : null;

  const budget =
    filters.span === "month" && filters.kind === "expense"
      ? budgets
          .filter(
            (b) =>
              (categorySet.size === 0 || categorySet.has(b.categoryId)) &&
              !(filters.withoutFixed && b.isFixed),
          )
          .reduce((total, b) => total + b.limitMinor, 0)
      : 0;

  /* ----------------------------------------------------- categories */

  const byCategory = new Map<string | null, StatRow[]>();
  for (const row of current) {
    const list = byCategory.get(row.categoryId) ?? [];
    list.push(row);
    byCategory.set(row.categoryId, list);
  }
  const categories: CategoryStat[] = [...byCategory.entries()]
    .map(([categoryId, list]) => {
      const total = sum(list);
      const compare = compareTotalOf((row) => row.categoryId === categoryId);
      return {
        categoryId,
        totalMinor: minor(total),
        count: list.length,
        share: totalMinor === 0 ? 0 : total / totalMinor,
        compareMinor: compare === null ? null : minor(compare),
        allFixed: list.every((row) => row.fixed),
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  /* ------------------------------------------------------ merchants */

  const byMerchant = new Map<string, StatRow[]>();
  for (const row of current) {
    const name = row.merchant?.trim();
    if (name === undefined || name === "") continue;
    const key = name.toLocaleLowerCase();
    const list = byMerchant.get(key) ?? [];
    list.push(row);
    byMerchant.set(key, list);
  }
  const merchants: MerchantStat[] = [...byMerchant.values()]
    .map((list) => {
      const counts = new Map<string | null, number>();
      for (const row of list) counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
      const categoryId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        name: list[0]?.merchant?.trim() ?? "",
        categoryId,
        totalMinor: minor(sum(list)),
        count: list.length,
        fixed: list.every((row) => row.fixed),
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor || b.count - a.count);

  /* ----------------------------------------------------------- when */

  const cells: { key: ISODate; totalMinor: Minor }[] = [];
  if (filters.span === "year") {
    for (let month = 0; month < 12; month += 1) {
      const start = toISODate(addMonths(new Date(`${period.from}T12:00:00`), month));
      const range = { from: start, to: toISODate(endOfMonth(new Date(`${start}T12:00:00`))) };
      cells.push({ key: start, totalMinor: minor(sum(current.filter((row) => within(row.on, range)))) });
    }
  } else {
    const daily = new Map<ISODate, number>();
    for (const row of current) daily.set(row.on, (daily.get(row.on) ?? 0) + row.amount);
    for (let index = 0; index < totalDays; index += 1) {
      const key = toISODate(new Date(new Date(`${period.from}T12:00:00`).getTime() + index * 86_400_000));
      cells.push({ key, totalMinor: minor(daily.get(key) ?? 0) });
    }
  }
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const row of current) {
    const weekday = (new Date(`${row.on}T12:00:00`).getDay() + 6) % 7;
    weekdays[weekday] = (weekdays[weekday] ?? 0) + row.amount;
  }
  const timed = current.flatMap((row) =>
    row.at === null ? [] : [[new Date(row.at).getTime(), row.amount] as const],
  );

  /* -------------------------------------------------- six months */

  const history = historyMonths(filters, today);
  const months = history.map((range) => range.from);
  const isComplete = (range: DateRange) => range.to < today;
  const hasData = (range: DateRange) => firstDataOn !== null && range.to >= firstDataOn;

  const expenses = rows.filter((row) => row.type === "expense" && inCategories(row));
  const splits: MonthSplit[] = history.map((range) => {
    const list = expenses.filter((row) => within(row.on, range));
    const fixed = sum(list.filter((row) => row.fixed));
    const flexible = sum(list) - fixed;
    const length = rangeDays(range);
    const elapsed = isComplete(range) ? length : Math.max(1, dayIndex(today, range) + 1);
    return {
      month: range.from,
      fixedMinor: minor(fixed),
      flexibleMinor: minor(flexible),
      projectedMinor: minor(isComplete(range) ? 0 : (flexible * length) / elapsed - flexible),
    };
  });
  const finished = splits.filter((_, index) => {
    const range = history[index];
    return range !== undefined && isComplete(range) && hasData(range);
  });
  const fixedAll = finished.reduce((total, m) => total + m.fixedMinor, 0);
  const flexibleAll = finished.reduce((total, m) => total + m.flexibleMinor, 0);

  const memberMonths: MemberMonth[] = history.map((range) => {
    const byMember: Record<string, Minor> = {};
    for (const row of flows) {
      if (row.memberId === null || !within(row.on, range)) continue;
      byMember[row.memberId] = minor((byMember[row.memberId] ?? 0) + row.amount);
    }
    return { month: range.from, byMember };
  });
  const memberTotals = new Map<string, number>();
  for (const row of current) {
    if (row.memberId !== null) memberTotals.set(row.memberId, (memberTotals.get(row.memberId) ?? 0) + row.amount);
  }
  const flexibleByMember = new Map<string, number>();
  const sixMonths = { from: history[0]?.from ?? period.from, to: history.at(-1)?.to ?? period.to };
  for (const row of flows) {
    if (row.memberId === null || row.fixed || !within(row.on, sixMonths)) continue;
    flexibleByMember.set(row.memberId, (flexibleByMember.get(row.memberId) ?? 0) + row.amount);
  }
  const flexibleTotal = [...flexibleByMember.values()].reduce((a, b) => a + b, 0);

  const savingsMonths: SavingsMonth[] = history.map((range) => {
    const list = rows.filter((row) => within(row.on, range));
    return {
      month: range.from,
      incomeMinor: minor(sum(list.filter((row) => row.type === "income"))),
      expenseMinor: minor(sum(list.filter((row) => row.type === "expense"))),
      complete: isComplete(range),
    };
  });
  const finishedSavings = savingsMonths.filter((m, index) => {
    const range = history[index];
    return m.complete && range !== undefined && hasData(range);
  });
  const finishedIncome = finishedSavings.reduce((total, m) => total + m.incomeMinor, 0);
  const finishedExpense = finishedSavings.reduce((total, m) => total + m.expenseMinor, 0);

  return {
    period,
    totalDays,
    elapsedDays,
    inProgress,
    compareRanges,
    summary: {
      totalMinor: minor(totalMinor),
      compareMinor: compareTotal === null ? null : minor(compareTotal),
      change: compareTotal === null || compareTotal === 0 ? null : totalMinor / compareTotal - 1,
      projectionMinor: projection === null ? null : minor(projection),
      budgetMinor: budget > 0 ? minor(budget) : null,
      current: currentCurve,
      compare: compareCurve,
    },
    categories,
    merchants: merchants.slice(0, 20),
    when: { cells, weekdays, timed },
    months,
    fixedFlexible: {
      months: splits,
      fixedAverageMinor: minor(finished.length === 0 ? 0 : fixedAll / finished.length),
      flexibleAverageMinor: minor(finished.length === 0 ? 0 : flexibleAll / finished.length),
      fixedShare: fixedAll + flexibleAll === 0 ? 0 : fixedAll / (fixedAll + flexibleAll),
    },
    members: {
      totals: [...memberTotals.entries()]
        .map(([memberId, total]) => ({ memberId, totalMinor: minor(total) }))
        .sort((a, b) => b.totalMinor - a.totalMinor),
      months: memberMonths,
      flexibleShares: [...flexibleByMember.entries()]
        .map(([memberId, total]) => ({ memberId, share: flexibleTotal === 0 ? 0 : total / flexibleTotal }))
        .sort((a, b) => b.share - a.share),
    },
    savings: {
      months: savingsMonths,
      rate: finishedIncome === 0 ? null : (finishedIncome - finishedExpense) / finishedIncome,
      savedMinor: minor(savingsMonths.reduce((total, m) => total + m.incomeMinor - m.expenseMinor, 0)),
    },
  };
}
