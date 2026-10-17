/**
 * Money. All of it.
 *
 * Amounts are integer **minor units** (cents, pence, yen). Floating point never
 * touches a monetary value: `0.1 + 0.2 !== 0.3` is a rounding bug waiting to be
 * reported as "the totals are off by a cent". Nothing outside this module should
 * do arithmetic on a raw amount.
 *
 * FX rates are integers scaled by RATE_SCALE for the same reason.
 */

declare const minorBrand: unique symbol;
declare const rateBrand: unique symbol;

/** An amount in integer minor units of some currency. */
export type Minor = number & { readonly [minorBrand]: true };

/** An FX rate multiplied by RATE_SCALE and rounded to an integer. */
export type ScaledRate = number & { readonly [rateBrand]: true };

/** FX rates keep 9 decimal places of precision. */
export const RATE_SCALE = 1_000_000_000;

export const ONE_TO_ONE = RATE_SCALE as ScaledRate;

/**
 * Currencies whose minor unit is not 1/100. Anything absent is assumed to have
 * two decimal places, which covers the overwhelming majority.
 */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** Currencies offered in the UI. Extend freely; nothing here is load-bearing. */
export const SUPPORTED_CURRENCIES = [
  // Slovakia is in the eurozone; the rest are ordered by how likely a trip or
  // an online order from here is to be billed in them.
  "EUR",
  "CZK",
  "PLN",
  "HUF",
  "UAH",
  "USD",
  "GBP",
  "CHF",
  "RON",
  "SEK",
  "NOK",
  "DKK",
  "TRY",
  "JPY",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Number of decimal places in the currency's minor unit. */
export function currencyExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

function pow10(exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i += 1) result *= 10;
  return result;
}

// --- constructors ---------------------------------------------------------

export const ZERO = 0 as Minor;

/**
 * Assert that a number is a usable minor-unit amount. Guards the boundary where
 * values arrive from the database or the network.
 */
export function toMinor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `Monetary value must be a safe integer of minor units, received ${value}`,
    );
  }
  return value as Minor;
}

/** Narrow a bigint (Postgres bigint columns arrive as strings/bigints). */
export function minorFromDb(value: string | number | bigint): Minor {
  const asNumber = typeof value === "number" ? value : Number(value);
  return toMinor(asNumber);
}

export function minorToDb(value: Minor): string {
  return String(value);
}

// --- parsing --------------------------------------------------------------

export type ParseResult =
  | { readonly ok: true; readonly value: Minor }
  | { readonly ok: false; readonly error: string };

/**
 * Parse human input into minor units.
 *
 * Accepts "1234.56", "1 234,56", "1,234.56", "-12", "€12.50", "(12.50)".
 * Rejects anything with more decimals than the currency has, rather than
 * silently rounding a number the user typed on purpose.
 */
export function parseMoneyInput(
  raw: string,
  currency: string,
): ParseResult {
  const exponent = currencyExponent(currency);
  let text = raw.trim();

  if (text.length === 0) return { ok: false, error: "Enter an amount" };

  // Accounting-style negatives: (12.50)
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Strip currency symbols, codes and whitespace used as a thousands separator.
  text = text.replace(/[\p{Sc}]/gu, "").replace(/[A-Za-z]/g, "");
  text = text.replace(/[\s  ']/g, "");

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (text.length === 0) return { ok: false, error: "Enter an amount" };

  // Work out which of . and , is the decimal separator.
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalSep = "";
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0) {
    decimalSep = ".";
  } else if (lastComma >= 0) {
    decimalSep = ",";
  }

  let integerPart = text;
  let fractionPart = "";

  if (decimalSep !== "") {
    const index = text.lastIndexOf(decimalSep);
    integerPart = text.slice(0, index);
    fractionPart = text.slice(index + 1);
    // A single separator with exactly 3 trailing digits is ambiguous:
    // "1,234" is almost always one thousand two hundred and thirty-four, not
    // 1.234. Treat it as a thousands separator — except for 3-decimal
    // currencies, where three trailing digits are exactly the minor unit and
    // the decimal reading is the right one.
    if (
      fractionPart.length === 3 &&
      exponent !== 3 &&
      !(lastDot >= 0 && lastComma >= 0) &&
      integerPart.length > 0
    ) {
      integerPart = integerPart + fractionPart;
      fractionPart = "";
    }
  }

  // Separators inside the integer part must form real 3-digit groups, so
  // malformed input like "1.2.3.4" is rejected rather than silently becoming
  // 123.4 by stripping every separator.
  if (/[.,]/.test(integerPart) && !/^\d{1,3}([.,]\d{3})*$/.test(integerPart)) {
    return { ok: false, error: "Not a valid amount" };
  }

  integerPart = integerPart.replace(/[.,]/g, "");
  if (integerPart === "") integerPart = "0";

  if (!/^\d+$/.test(integerPart) || (fractionPart !== "" && !/^\d+$/.test(fractionPart))) {
    return { ok: false, error: "Not a valid amount" };
  }

  if (fractionPart.length > exponent) {
    return {
      ok: false,
      error:
        exponent === 0
          ? `${currency} amounts cannot have decimals`
          : `${currency} amounts have at most ${exponent} decimal places`,
    };
  }

  const paddedFraction = fractionPart.padEnd(exponent, "0");
  const combined = `${integerPart}${paddedFraction}`;

  const magnitude = Number(combined);
  if (!Number.isSafeInteger(magnitude)) {
    return { ok: false, error: "Amount is too large" };
  }

  return { ok: true, value: (negative ? -magnitude : magnitude) as Minor };
}

// --- formatting -----------------------------------------------------------

export interface FormatOptions {
  /**
   * Required, like the date helpers, and for the same reason: an optional
   * locale with a default lets a new call site render in the wrong language
   * and still compile.
   */
  readonly locale: string;
  /** Render without the currency symbol. */
  readonly bare?: boolean;
  /** Always show a leading + for positive amounts. */
  readonly signed?: boolean;
  /** Drop the decimals (for axis ticks and compact tiles). */
  readonly noDecimals?: boolean;
}

export function formatMoney(
  minor: Minor,
  currency: string,
  options: FormatOptions,
): string {
  const exponent = currencyExponent(currency);
  const decimals = options.noDecimals === true ? 0 : exponent;
  const value = minor / pow10(exponent);

  const formatter = new Intl.NumberFormat(options.locale, {
    style: options.bare === true ? "decimal" : "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed === true ? "exceptZero" : "auto",
  });

  return formatter.format(value);
}

/** Compact form for chart axes and KPI tiles: €1.2k, €3.4M. */
export function formatMoneyCompact(
  minor: Minor,
  currency: string,
  locale: string,
): string {
  const exponent = currencyExponent(currency);
  const value = minor / pow10(exponent);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Convert minor units to a plain number for charting libraries, which cannot
 * consume branded integers. Only ever call this at the boundary of a chart.
 */
export function minorToChartValue(minor: Minor, currency: string): number {
  return minor / pow10(currencyExponent(currency));
}

/** Render minor units as an editable decimal string, e.g. for form defaults. */
export function minorToInputString(minor: Minor, currency: string): string {
  const exponent = currencyExponent(currency);
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0");
  const cut = digits.length - exponent;
  const integerPart = digits.slice(0, cut);
  const fractionPart = digits.slice(cut);
  const body =
    exponent === 0 ? integerPart : `${integerPart}.${fractionPart}`;
  return negative ? `-${body}` : body;
}

// --- arithmetic -----------------------------------------------------------

export function addMinor(a: Minor, b: Minor): Minor {
  return toMinor(a + b);
}

export function subtractMinor(a: Minor, b: Minor): Minor {
  return toMinor(a - b);
}

export function negateMinor(a: Minor): Minor {
  return toMinor(0 - a);
}

export function absMinor(a: Minor): Minor {
  return toMinor(Math.abs(a));
}

export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const value of values) total += value;
  return toMinor(total);
}

/**
 * Halves an amount for a «пополам» entry, as two rows that sum exactly to it.
 *
 * Integer minor units cannot split an odd amount evenly, and rounding both
 * halves would either lose or invent a cent. The odd unit goes to the first
 * half — by convention the person entering it, who is the one at the till
 * holding the extra cent. Sign is preserved on both halves, so an expense
 * splits into two expenses.
 */
export function splitMinor(amount: Minor): readonly [first: Minor, second: Minor] {
  const sign = amount < 0 ? -1 : 1;
  const magnitude = Math.abs(amount);
  const smaller = Math.floor(magnitude / 2);
  const larger = magnitude - smaller;
  return [toMinor(sign * larger || 0), toMinor(sign * smaller || 0)];
}

export function isZero(value: Minor): boolean {
  return value === 0;
}

/** Percentage of `part` relative to `whole`, guarding division by zero. */
export function percentOf(part: Minor, whole: Minor): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}

// --- FX -------------------------------------------------------------------

export function toScaledRate(rate: number): ScaledRate {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`FX rate must be a positive finite number, got ${rate}`);
  }
  const scaled = Math.round(rate * RATE_SCALE);
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`FX rate out of range: ${rate}`);
  }
  return scaled as ScaledRate;
}

export function scaledRateToNumber(rate: ScaledRate): number {
  return rate / RATE_SCALE;
}

export function rateFromDb(value: string | number | bigint): ScaledRate {
  const asNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
    throw new RangeError(`Invalid stored FX rate: ${String(value)}`);
  }
  return asNumber as ScaledRate;
}

/**
 * Convert an amount into the household's base currency using the rate captured
 * when the transaction was recorded. BigInt keeps the intermediate product
 * exact; historical rows are never re-converted at today's rate.
 */
export function convertToBase(amount: Minor, rate: ScaledRate): Minor {
  const product = BigInt(amount) * BigInt(rate);
  const scale = BigInt(RATE_SCALE);
  const half = scale / 2n;
  // Round half away from zero, matching how people expect money to round.
  const rounded =
    product >= 0n ? (product + half) / scale : -((-product + half) / scale);
  const asNumber = Number(rounded);
  return toMinor(asNumber);
}

/** Parse an FX rate typed by a human, e.g. "24.35" CZK per EUR. */
export function parseRateInput(raw: string):
  | { readonly ok: true; readonly value: ScaledRate }
  | { readonly ok: false; readonly error: string } {
  const text = raw.trim().replace(",", ".");
  if (!/^\d*\.?\d+$/.test(text)) {
    return { ok: false, error: "Not a valid rate" };
  }
  const asNumber = Number(text);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return { ok: false, error: "Rate must be greater than zero" };
  }
  return { ok: true, value: toScaledRate(asNumber) };
}
