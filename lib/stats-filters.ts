import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { isISODate, toISODate, type DateRange, type ISODate } from "@/lib/date";

/**
 * What Статистика is looking at (boards L15 and L19 «Фильтры»), kept in the
 * URL so a filtered view survives a reload, the back button and a kept-alive
 * screen. Defaults are left out of the query string, so the plain /stats is
 * «this month, everything, against last month».
 */

export const STATS_SPANS = ["week", "month", "year"] as const;
export type StatsSpan = (typeof STATS_SPANS)[number];

/** «Считать»: what money the flow charts count. */
export const STATS_KINDS = ["expense", "income", "all"] as const;
export type StatsKind = (typeof STATS_KINDS)[number];

/** «Сравнивать с»: the previous period, or the average of the six before. */
export const STATS_COMPARES = ["previous", "average"] as const;
export type StatsCompare = (typeof STATS_COMPARES)[number];

export interface StatsFilters {
  readonly span: StatsSpan;
  /** Any day inside the period; the period is the span around it. */
  readonly at: ISODate;
  readonly categoryIds: readonly string[];
  readonly memberId: string | null;
  readonly accountId: string | null;
  readonly kind: StatsKind;
  /** «Без постоянных платежей»: leave out rows a recurring rule produced. */
  readonly withoutFixed: boolean;
  readonly compare: StatsCompare;
}

/** How many earlier periods «среднее» averages over. */
export const AVERAGE_OF = 6;

type Params = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(
  values: readonly T[],
  raw: string | undefined,
  fallback: T,
): T {
  return values.find((value) => value === raw) ?? fallback;
}

const ID = /^[\w-]{1,64}$/;

export function defaultStatsFilters(today: ISODate): StatsFilters {
  return {
    span: "month",
    at: today,
    categoryIds: [],
    memberId: null,
    accountId: null,
    kind: "expense",
    withoutFixed: false,
    compare: "previous",
  };
}

export function parseStatsFilters(params: Params, today: ISODate): StatsFilters {
  const at = first(params.at);
  const who = first(params.who);
  const account = first(params.acc);
  return {
    span: oneOf(STATS_SPANS, first(params.span), "month"),
    // A period that has not started yet has nothing to show.
    at: at !== undefined && isISODate(at) && at <= today ? at : today,
    categoryIds: (first(params.cat) ?? "")
      .split(",")
      .filter((id) => ID.test(id)),
    memberId: who !== undefined && ID.test(who) ? who : null,
    accountId: account !== undefined && ID.test(account) ? account : null,
    kind: oneOf(STATS_KINDS, first(params.kind), "expense"),
    withoutFixed: first(params.nofixed) === "1",
    compare: first(params.cmp) === "avg" ? "average" : "previous",
  };
}

/** The query string for `filters`, without the defaults. */
export function statsQuery(filters: StatsFilters, today: ISODate): string {
  const q = new URLSearchParams();
  if (filters.span !== "month") q.set("span", filters.span);
  if (!sameStatsPeriod(filters.span, filters.at, today)) q.set("at", filters.at);
  if (filters.categoryIds.length > 0) q.set("cat", filters.categoryIds.join(","));
  if (filters.memberId !== null) q.set("who", filters.memberId);
  if (filters.accountId !== null) q.set("acc", filters.accountId);
  if (filters.kind !== "expense") q.set("kind", filters.kind);
  if (filters.withoutFixed) q.set("nofixed", "1");
  if (filters.compare === "average") q.set("cmp", "avg");
  return q.toString();
}

/** How many filters narrow the data (the period is not one of them). */
export function activeFilterCount(filters: StatsFilters): number {
  return (
    (filters.categoryIds.length > 0 ? 1 : 0) +
    (filters.memberId !== null ? 1 : 0) +
    (filters.accountId !== null ? 1 : 0) +
    (filters.kind !== "expense" ? 1 : 0) +
    (filters.withoutFixed ? 1 : 0) +
    (filters.compare !== "previous" ? 1 : 0)
  );
}

/* ---------------------------------------------------------------- periods */

function day(value: ISODate): Date {
  return new Date(`${value}T12:00:00`);
}

export function statsPeriod(span: StatsSpan, at: ISODate): DateRange {
  const date = day(at);
  switch (span) {
    case "week":
      return {
        from: toISODate(startOfWeek(date, { weekStartsOn: 1 })),
        to: toISODate(endOfWeek(date, { weekStartsOn: 1 })),
      };
    case "month":
      return { from: toISODate(startOfMonth(date)), to: toISODate(endOfMonth(date)) };
    case "year":
      return { from: toISODate(startOfYear(date)), to: toISODate(endOfYear(date)) };
  }
}

/** The period `steps` spans away from the one holding `at` (negative: earlier). */
export function shiftStatsPeriod(span: StatsSpan, at: ISODate, steps: number): DateRange {
  const date = day(statsPeriod(span, at).from);
  const moved =
    span === "week"
      ? addWeeks(date, steps)
      : span === "month"
        ? addMonths(date, steps)
        : addYears(date, steps);
  return statsPeriod(span, toISODate(moved));
}

export function sameStatsPeriod(span: StatsSpan, a: ISODate, b: ISODate): boolean {
  return statsPeriod(span, a).from === statsPeriod(span, b).from;
}

/** Inclusive length in days. */
export function rangeDays(range: DateRange): number {
  return Math.round((day(range.to).getTime() - day(range.from).getTime()) / 86_400_000) + 1;
}

/** `range` cut to its first `days` days. */
export function firstDays(range: DateRange, days: number): DateRange {
  const to = toISODate(addDays(day(range.from), Math.max(0, days - 1)));
  return { from: range.from, to: to < range.to ? to : range.to };
}
