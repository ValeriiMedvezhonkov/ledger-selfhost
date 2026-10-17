import { enGB, ru } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/locale";

/**
 * How each interface language formats dates and money.
 *
 * `en` maps to `en-GB` rather than `en-US`: the household is in Europe, so
 * day-before-month and a trailing euro are what people here expect to read
 * even when the interface is in English.
 */
export interface FormatLocale {
  /** For date-fns, which supplies month and weekday names. */
  readonly dateFns: DateFnsLocale;
  /** For Intl.NumberFormat, which supplies grouping and currency placement. */
  readonly intl: string;
}

export const FORMAT_LOCALES: Readonly<Record<Locale, FormatLocale>> = {
  en: { dateFns: enGB, intl: "en-GB" },
  ru: { dateFns: ru, intl: "ru-RU" },
};

export function formatLocaleFor(locale: string): FormatLocale {
  return FORMAT_LOCALES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}
