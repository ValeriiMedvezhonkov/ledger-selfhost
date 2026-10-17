import type { CurrencyCode } from "@/lib/money";

/**
 * Display metadata for the currencies the app offers.
 *
 * `formatMoney` already renders symbols inside amounts via `Intl`; this exists
 * for the places that show a *bare* currency — pickers, field labels, account
 * cards — where "EUR" alone is harder to scan than "🇪🇺 EUR €".
 *
 * Flags are emoji, so they inherit the platform's font. macOS and iOS draw
 * them; Windows renders the two-letter code instead, which is still legible
 * next to the ISO code and the symbol. Nothing depends on the flag alone.
 */
export interface CurrencyMeta {
  readonly symbol: string;
  readonly flag: string;
  readonly name: string;
}

export const CURRENCY_META: Readonly<Record<CurrencyCode, CurrencyMeta>> = {
  EUR: { symbol: "€", flag: "🇪🇺", name: "Euro" },
  CZK: { symbol: "Kč", flag: "🇨🇿", name: "Czech koruna" },
  PLN: { symbol: "zł", flag: "🇵🇱", name: "Polish złoty" },
  HUF: { symbol: "Ft", flag: "🇭🇺", name: "Hungarian forint" },
  UAH: { symbol: "₴", flag: "🇺🇦", name: "Ukrainian hryvnia" },
  USD: { symbol: "$", flag: "🇺🇸", name: "US dollar" },
  GBP: { symbol: "£", flag: "🇬🇧", name: "Pound sterling" },
  CHF: { symbol: "CHF", flag: "🇨🇭", name: "Swiss franc" },
  RON: { symbol: "lei", flag: "🇷🇴", name: "Romanian leu" },
  SEK: { symbol: "kr", flag: "🇸🇪", name: "Swedish krona" },
  NOK: { symbol: "kr", flag: "🇳🇴", name: "Norwegian krone" },
  DKK: { symbol: "kr", flag: "🇩🇰", name: "Danish krone" },
  TRY: { symbol: "₺", flag: "🇹🇷", name: "Turkish lira" },
  JPY: { symbol: "¥", flag: "🇯🇵", name: "Japanese yen" },
};

/**
 * The same table, typed as a partial lookup.
 *
 * `CURRENCY_META` is exhaustive over `CurrencyCode` so the compiler catches a
 * missing entry when a currency is added. Reads, though, come from stored data
 * and may name a code the picker no longer offers — an existing transaction in
 * HRK, say, which was removed when Croatia adopted the euro. Widening the key
 * to `string` here makes that possibility visible instead of pretending every
 * lookup succeeds.
 */
const LOOKUP: Readonly<Partial<Record<string, CurrencyMeta>>> = CURRENCY_META;

/** Metadata for any stored code. Never throws on an unknown one. */
export function currencyMeta(code: string): CurrencyMeta {
  return LOOKUP[code] ?? { symbol: "", flag: "🏳️", name: code };
}

/** Just the symbol, for field labels like "Monthly limit (€)". */
export function currencySymbol(code: string): string {
  const symbol = currencyMeta(code).symbol;
  return symbol === "" ? code : symbol;
}
