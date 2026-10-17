import {
  addDays,
  endOfMonth,
  endOfQuarter,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subQuarters,
  subYears,
} from "date-fns";
import {
  currentMonthRange,
  isISODate,
  previousMonthRange,
  toISODate,
  type DateRange,

} from "@/lib/date";

/**
 * The periods Обзор can answer for — the «Период» menu (board L11):
 * this month, last month, this quarter, this year, or a picked range.
 */
export const PERIOD_KEYS = ["month", "last", "quarter", "year", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface Period {
  readonly key: PeriodKey;
  readonly range: DateRange;
  /** The same length of time immediately before, for «+8% к сентябрю». */
  readonly previous: DateRange;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePeriod(
  params: Readonly<Record<string, string | string[] | undefined>>,
  now: Date,
): Period {
  const key = first(params.period);
  switch (key) {
    case "last": {
      const range = previousMonthRange(now);
      const before = subMonths(now, 2);
      return {
        key: "last",
        range,
        previous: { from: toISODate(startOfMonth(before)), to: toISODate(endOfMonth(before)) },
      };
    }
    case "quarter":
      return {
        key: "quarter",
        range: { from: toISODate(startOfQuarter(now)), to: toISODate(endOfQuarter(now)) },
        previous: {
          from: toISODate(startOfQuarter(subQuarters(now, 1))),
          to: toISODate(endOfQuarter(subQuarters(now, 1))),
        },
      };
    case "year":
      return {
        key: "year",
        range: { from: toISODate(startOfYear(now)), to: toISODate(now) },
        previous: {
          from: toISODate(startOfYear(subYears(now, 1))),
          to: toISODate(subYears(now, 1)),
        },
      };
    case "custom": {
      const from = first(params.from);
      const to = first(params.to);
      if (from !== undefined && to !== undefined && isISODate(from) && isISODate(to) && from <= to) {
        const span = Math.round(
          (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) /
            86_400_000,
        );
        const prevTo = new Date(`${from}T12:00:00`);
        prevTo.setDate(prevTo.getDate() - 1);
        const prevFrom = new Date(prevTo);
        prevFrom.setDate(prevFrom.getDate() - span);
        return {
          key: "custom",
          range: { from, to },
          previous: { from: toISODate(prevFrom), to: toISODate(prevTo) },
        };
      }
      break;
    }
    case undefined:
    default:
      break;
  }
  /*
   * The month so far against the same days of last month: on the 2nd, two
   * days of income against a whole September would always read «−100%».
   */
  const last = previousMonthRange(now);
  const sameDays = toISODate(addDays(new Date(`${last.from}T12:00:00`), now.getDate() - 1));
  return {
    key: "month",
    range: currentMonthRange(now),
    previous: { from: last.from, to: sameDays < last.to ? sameDays : last.to },
  };
}
