import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
} from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import type { RecurrenceFrequency } from "@/db/schema";

/**
 * Calendar dates are stored and passed as "YYYY-MM-DD" strings. A transaction
 * happened on a date, not at an instant, so it must not drift when the server
 * and the phone disagree about the timezone.
 */
export type ISODate = string & { readonly __isoDate?: never };

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && isValid(parseISO(value));
}

export function toISODate(value: Date): ISODate {
  return format(value, "yyyy-MM-dd");
}

export function fromISODate(value: ISODate): Date {
  return parseISO(value);
}

/** Today, in the caller's timezone. Pass the clock in explicitly. */
export function todayISO(now: Date): ISODate {
  return toISODate(now);
}

export function monthStartISO(value: ISODate): ISODate {
  return toISODate(startOfMonth(parseISO(value)));
}

export function monthEndISO(value: ISODate): ISODate {
  return toISODate(endOfMonth(parseISO(value)));
}

export function addDaysISO(value: ISODate, amount: number): ISODate {
  return toISODate(addDays(parseISO(value), amount));
}

export function addMonthsISO(value: ISODate, amount: number): ISODate {
  return toISODate(addMonths(parseISO(value), amount));
}

export function daysBetweenISO(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Advance a date by one recurrence step. */
export function advanceByFrequency(
  value: ISODate,
  frequency: RecurrenceFrequency,
  interval: number,
): ISODate {
  const date = parseISO(value);
  const step = Math.max(1, Math.trunc(interval));

  switch (frequency) {
    case "daily":
      return toISODate(addDays(date, step));
    case "weekly":
      return toISODate(addWeeks(date, step));
    case "monthly":
      return toISODate(addMonths(date, step));
    case "yearly":
      return toISODate(addYears(date, step));
  }
}

// --- ranges ---------------------------------------------------------------

export interface DateRange {
  readonly from: ISODate;
  readonly to: ISODate;
}

/** The N most recent whole months, inclusive of the current one. */
export function lastNMonths(now: Date, count: number): DateRange {
  const end = endOfMonth(now);
  const start = startOfMonth(subMonths(now, Math.max(0, count - 1)));
  return { from: toISODate(start), to: toISODate(end) };
}

export function currentMonthRange(now: Date): DateRange {
  return {
    from: toISODate(startOfMonth(now)),
    to: toISODate(endOfMonth(now)),
  };
}

export function previousMonthRange(now: Date): DateRange {
  const previous = subMonths(now, 1);
  return {
    from: toISODate(startOfMonth(previous)),
    to: toISODate(endOfMonth(previous)),
  };
}

/** The last N days, ending today and inclusive of it. */
export function lastNDaysRange(now: Date, days: number): DateRange {
  return {
    from: toISODate(addDays(now, -(Math.max(1, days) - 1))),
    to: toISODate(now),
  };
}

/** 1 January to today. */
export function yearToDateRange(now: Date): DateRange {
  return {
    from: toISODate(startOfYear(now)),
    to: toISODate(now),
  };
}

// --- bucketing ------------------------------------------------------------

export type Granularity = "day" | "week" | "month";

/** The bucket key a date falls into, used to group stats rows. */
export function bucketKey(value: ISODate, granularity: Granularity): string {
  const date = parseISO(value);
  switch (granularity) {
    case "day":
      return toISODate(date);
    case "week":
      return toISODate(startOfWeek(date, { weekStartsOn: 1 }));
    case "month":
      return toISODate(startOfMonth(date));
  }
}

/** Every bucket in a range, so charts show gaps as zero instead of skipping. */
export function enumerateBuckets(
  range: DateRange,
  granularity: Granularity,
): ISODate[] {
  const result: ISODate[] = [];
  const end = parseISO(range.to);
  let cursor = parseISO(bucketKey(range.from, granularity));

  while (cursor <= end) {
    result.push(toISODate(cursor));
    switch (granularity) {
      case "day":
        cursor = addDays(cursor, 1);
        break;
      case "week":
        cursor = addWeeks(cursor, 1);
        break;
      case "month":
        cursor = addMonths(cursor, 1);
        break;
    }
  }

  return result;
}

// --- display --------------------------------------------------------------

/*
 * Display helpers take the locale explicitly rather than defaulting to one.
 * A default would let a forgotten call site render in the wrong language and
 * still compile; this way the compiler names every place that has to care.
 * Only presentation is affected — bucketKey and the ISO helpers above stay
 * locale-independent, because they produce keys, not text.
 */

export function formatDateLabel(value: ISODate, locale: DateFnsLocale): string {
  return format(parseISO(value), "d MMM yyyy", { locale });
}

export function formatDateShort(value: ISODate, locale: DateFnsLocale): string {
  return format(parseISO(value), "d MMM", { locale });
}

export function formatMonthLabel(value: ISODate, locale: DateFnsLocale): string {
  return format(parseISO(value), "LLLL yyyy", { locale });
}

export function formatBucketLabel(
  value: ISODate,
  granularity: Granularity,
  locale: DateFnsLocale,
): string {
  switch (granularity) {
    case "day":
      return format(parseISO(value), "d MMM", { locale });
    case "week": {
      // A week bucket is labelled by its span, not its first day. Formatting it
      // like a day made weekly and daily axes indistinguishable — "3 Aug" reads
      // as one date. A range says which it is without needing a translated
      // "week of" prefix, which this module could not resolve anyway.
      const start = parseISO(value);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      return sameMonth
        ? `${format(start, "d", { locale })}–${format(end, "d MMM", { locale })}`
        : `${format(start, "d MMM", { locale })}–${format(end, "d MMM", { locale })}`;
    }
    case "month":
      return format(parseISO(value), "LLL yy", { locale });
  }
}

/** Days left in the month containing `value`, inclusive of that day. */
export function daysRemainingInMonth(value: ISODate): number {
  return differenceInCalendarDays(endOfMonth(parseISO(value)), parseISO(value)) + 1;
}

export function daysElapsedInMonth(value: ISODate): number {
  return differenceInCalendarDays(parseISO(value), startOfMonth(parseISO(value))) + 1;
}
