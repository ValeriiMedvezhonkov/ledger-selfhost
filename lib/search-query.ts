import { SUPPORTED_CURRENCIES, parseMoneyInput, type Minor } from "@/lib/money";

/**
 * The transactions search box, read as a tiny query language.
 *
 * Most of what people type is text ("lidl"), but the question behind a search
 * is as often "what was that big one?" — so an amount expression anywhere in
 * the box filters by size instead of being matched against merchant names it
 * could never appear in:
 *
 *   > 50       more than 50
 *   <20        less than 20
 *   =12,50     exactly 12.50
 *   10-30      between 10 and 30, inclusive
 *   lidl >20   both: text "lidl", amount over 20
 *
 * Amounts compare against the *magnitude* in base currency, so "> 50" finds a
 * 60 € expense and a 60 € refund alike; direction is what the type filter is
 * for. A currency symbol or code next to the number ("> 50 €", ">€50",
 * "<20 eur") is allowed and ignored — the comparison is always in base.
 *
 * Pure and dependency-free beyond the money parser, so it is unit-tested
 * directly rather than through a database.
 */

export type AmountOp = "gt" | "lt" | "eq" | "between";

export interface AmountFilter {
  readonly op: AmountOp;
  /** Lower bound: exclusive for `gt`, inclusive for `between` and `eq`. */
  readonly minMinor?: Minor;
  /** Upper bound: exclusive for `lt`, inclusive for `between` and `eq`. */
  readonly maxMinor?: Minor;
}

export interface ParsedSearchQuery {
  /** What is left once amount expressions are taken out, whitespace-collapsed. */
  readonly text: string;
  readonly amount: AmountFilter | null;
}

/**
 * Symbols and codes tolerated around a number. Deliberately a closed list: a
 * free-form "three letters after the number" rule would swallow a real word in
 * "> 20 bar".
 */
const CURRENCY_WORDS = [
  ...SUPPORTED_CURRENCIES.map((code) => code.toLowerCase()),
  "kč",
  "zł",
  "ft",
  "грн",
  "руб",
];

const SYMBOL = String.raw`(?:\p{Sc}|${CURRENCY_WORDS.join("|")})`;
/** A number as people type one: digits with at most `.`/`,` separators. */
const NUMBER = String.raw`\d+(?:[.,]\d+)*`;

/** `>50`, `> 50 €`, `>€50`, `=12,50`. */
const COMPARISON = new RegExp(
  String.raw`(?<=^|\s)([<>=])\s*${SYMBOL}?\s*(${NUMBER})(?:\s*${SYMBOL})?(?=\s|$)`,
  "iu",
);

/** `10-30`, `10 – 30 €`. Dashes of every width, because phones substitute them. */
const RANGE = new RegExp(
  String.raw`(?<=^|\s)${SYMBOL}?(${NUMBER})\s*[-–—]\s*${SYMBOL}?(${NUMBER})(?:\s*${SYMBOL})?(?=\s|$)`,
  "iu",
);

function magnitude(raw: string, currency: string): Minor | null {
  const parsed = parseMoneyInput(raw, currency);
  if (!parsed.ok) return null;
  return parsed.value < 0 ? null : parsed.value;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Splits a search string into free text and at most one amount filter.
 *
 * Only the first amount expression counts; any others are dropped from the
 * text as well, because matching "<20" against merchant names cannot find
 * anything and would quietly turn the whole search into "no results".
 *
 * `currency` decides how many decimals a number may carry — the household's
 * base currency, since that is what the comparison runs against.
 */
export function parseSearchQuery(
  q: string,
  currency = "EUR",
): ParsedSearchQuery {
  let text = q;
  let amount: AmountFilter | null = null;

  // Ranges first: "10-30" must not be read as the number 10 followed by junk.
  for (;;) {
    const match = RANGE.exec(text);
    if (match === null) break;
    const [whole, rawLow = "", rawHigh = ""] = match;
    const low = magnitude(rawLow, currency);
    const high = magnitude(rawHigh, currency);
    // A reversed or unreadable range is not an amount — "2026-08" stays text.
    if (low === null || high === null || low > high) break;
    amount ??= { op: "between", minMinor: low, maxMinor: high };
    text = text.slice(0, match.index) + " " + text.slice(match.index + whole.length);
  }

  for (;;) {
    const match = COMPARISON.exec(text);
    if (match === null) break;
    const [whole, operator = "", rawValue = ""] = match;
    const value = magnitude(rawValue, currency);
    if (value === null) break;

    amount ??=
      operator === ">"
        ? { op: "gt", minMinor: value }
        : operator === "<"
          ? { op: "lt", maxMinor: value }
          : { op: "eq", minMinor: value, maxMinor: value };
    text = text.slice(0, match.index) + " " + text.slice(match.index + whole.length);
  }

  return { text: collapse(text), amount };
}
