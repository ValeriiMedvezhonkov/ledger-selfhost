import "server-only";
import { getLocale } from "@/lib/locale-server";
import {
  formatBucketLabel,
  formatDateLabel,
  formatDateShort,
  formatMonthLabel,
} from "@/lib/date";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { formatLocaleFor } from "@/lib/formats";
import type { Formats } from "@/hooks/use-formats";

/**
 * The async-server-component counterpart to `useFormats`.
 *
 * `useFormats` is a hook, and hooks cannot be called inside an `async`
 * component — so anything that awaits its data uses this instead. Same shape,
 * same output; only how the locale is read differs.
 */
export async function getFormats(): Promise<Formats> {
  const { dateFns, intl } = formatLocaleFor(await getLocale());

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
