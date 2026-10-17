import { useLocale } from "next-intl";
import {
  formatBucketLabel,
  formatDateLabel,
  formatDateShort,
  formatMonthLabel,
  type Granularity,
  type ISODate,
} from "@/lib/date";
import {
  formatMoney,
  formatMoneyCompact,
  type FormatOptions,
  type Minor,
} from "@/lib/money";
import { formatLocaleFor } from "@/lib/formats";
import type { Locale as DateFnsLocale } from "date-fns";

export interface Formats {
  /** For <Calendar locale={...} />, so the popover matches the trigger. */
  readonly calendar: DateFnsLocale;
  /**
   * `locale` is omitted deliberately: it is the one option callers must not set,
   * because these accessors exist to bind it to the interface language.
   */
  readonly money: (
    minor: Minor,
    currency: string,
    options?: Omit<FormatOptions, "locale">,
  ) => string;
  readonly moneyCompact: (minor: Minor, currency: string) => string;
  readonly date: (value: ISODate) => string;
  /** An instant, not a calendar date — for logs and audit trails. */
  readonly dateTime: (value: Date) => string;
  readonly dateShort: (value: ISODate) => string;
  readonly month: (value: ISODate) => string;
  readonly bucket: (value: ISODate, granularity: Granularity) => string;
}

/**
 * Date and money formatting bound to the interface language.
 *
 * `useLocale` works in both Server and Client Components, so one hook covers
 * the whole tree — no server/client split. Nothing is memoised: in an RSC there
 * are no hooks to memoise with, and the work is a handful of `Intl` calls.
 */
export function useFormats(): Formats {
  const { dateFns, intl } = formatLocaleFor(useLocale());

  return {
    calendar: dateFns,
    money: (minor, currency, options) =>
      formatMoney(minor, currency, { ...options, locale: intl }),
    moneyCompact: (minor, currency) => formatMoneyCompact(minor, currency, intl),
    date: (value) => formatDateLabel(value, dateFns),
    dateTime: (value) =>
      new Intl.DateTimeFormat(intl, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(value),
    dateShort: (value) => formatDateShort(value, dateFns),
    month: (value) => formatMonthLabel(value, dateFns),
    bucket: (value, granularity) => formatBucketLabel(value, granularity, dateFns),
  };
}
