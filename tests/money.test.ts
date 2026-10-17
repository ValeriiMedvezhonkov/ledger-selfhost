import { describe, expect, it } from "vitest";
import {
  ONE_TO_ONE,
  addMinor,
  convertToBase,
  currencyExponent,
  formatMoney,
  minorToInputString,
  negateMinor,
  parseMoneyInput,
  parseRateInput,
  percentOf,
  sumMinor,
  toMinor,
  toScaledRate,
} from "@/lib/money";

describe("parseMoneyInput", () => {
  it("parses plain decimals", () => {
    expect(parseMoneyInput("12.34", "EUR")).toEqual({ ok: true, value: 1234 });
    expect(parseMoneyInput("0.05", "EUR")).toEqual({ ok: true, value: 5 });
    expect(parseMoneyInput("100", "EUR")).toEqual({ ok: true, value: 10000 });
  });

  it("accepts a comma as the decimal separator", () => {
    expect(parseMoneyInput("12,34", "EUR")).toEqual({ ok: true, value: 1234 });
  });

  it("handles thousands separators in both conventions", () => {
    expect(parseMoneyInput("1,234.56", "EUR")).toEqual({ ok: true, value: 123456 });
    expect(parseMoneyInput("1.234,56", "EUR")).toEqual({ ok: true, value: 123456 });
    expect(parseMoneyInput("1 234,56", "EUR")).toEqual({ ok: true, value: 123456 });
  });

  it("reads an ambiguous single separator with 3 digits as thousands", () => {
    expect(parseMoneyInput("1,234", "EUR")).toEqual({ ok: true, value: 123400 });
  });

  it("handles negatives, including accounting parentheses", () => {
    expect(parseMoneyInput("-12.34", "EUR")).toEqual({ ok: true, value: -1234 });
    expect(parseMoneyInput("(12.34)", "EUR")).toEqual({ ok: true, value: -1234 });
  });

  it("strips currency symbols and codes", () => {
    expect(parseMoneyInput("€12.34", "EUR")).toEqual({ ok: true, value: 1234 });
    expect(parseMoneyInput("12.34 EUR", "EUR")).toEqual({ ok: true, value: 1234 });
  });

  it("respects the currency's exponent", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(parseMoneyInput("1200", "JPY")).toEqual({ ok: true, value: 1200 });
    expect(parseMoneyInput("12.5", "JPY").ok).toBe(false);
    expect(currencyExponent("KWD")).toBe(3);
    expect(parseMoneyInput("1.234", "KWD")).toEqual({ ok: true, value: 1234 });
  });

  it("rejects more precision than the currency has, rather than rounding it away", () => {
    const result = parseMoneyInput("12.3456", "EUR");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("2 decimal places");
  });

  it("resolves the 3-digit ambiguity as a thousands separator", () => {
    // "12.345" is genuinely ambiguous. For a 2-decimal currency it cannot be
    // a fraction, so the grouped reading is the only sensible one.
    expect(parseMoneyInput("12.345", "EUR")).toEqual({ ok: true, value: 1234500 });
  });

  it("rejects junk and empty input", () => {
    expect(parseMoneyInput("", "EUR").ok).toBe(false);
    expect(parseMoneyInput("abc", "EUR").ok).toBe(false);
    expect(parseMoneyInput("1.2.3.4", "EUR").ok).toBe(false);
  });

  it("rejects amounts beyond safe integer range", () => {
    expect(parseMoneyInput("999999999999999999999", "EUR").ok).toBe(false);
  });
});

describe("float safety", () => {
  it("does not accumulate error the way float arithmetic would", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    const a = parseMoneyInput("0.10", "EUR");
    const b = parseMoneyInput("0.20", "EUR");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(addMinor(a.value, b.value)).toBe(30);
    // Russian formatting: comma as the decimal separator.
    expect(
      formatMoney(addMinor(a.value, b.value), "EUR", {
        bare: true,
        locale: "ru-RU",
      }),
    ).toBe("0,30");
  });

  it("sums a long list without drift", () => {
    const values = Array.from({ length: 1000 }, () => toMinor(1));
    expect(sumMinor(values)).toBe(1000);
  });
});

describe("locale-driven formatting", () => {
  // The interface ships in two languages, so those are the two that get tested.
  // Formatting is entirely locale-driven now that there is no default.

  it("renders Russian with a comma decimal and a trailing euro sign", () => {
    const formatted = formatMoney(toMinor(123456), "EUR", { locale: "ru-RU" });
    expect(formatted).toContain(",56");
    expect(formatted).toContain("€");
    // ru-RU groups thousands with a space, not a comma.
    expect(formatted).not.toContain("1,234");
  });

  it("renders English with a point decimal and a leading euro sign", () => {
    const formatted = formatMoney(toMinor(123456), "EUR", { locale: "en-GB" });
    expect(formatted).toContain(".56");
    expect(formatted).toContain("€");
    expect(formatted).toContain("1,234");
  });

  it("still parses what it formats, round trip, in both languages", () => {
    for (const locale of ["en-GB", "ru-RU"]) {
      const formatted = formatMoney(toMinor(123456), "EUR", { locale });
      expect(parseMoneyInput(formatted, "EUR")).toEqual({
        ok: true,
        value: 123456,
      });
    }
  });

  it("parses continental input with a comma decimal", () => {
    // Kept regardless of interface language: people here type amounts this way.
    expect(parseMoneyInput("1 234,56", "EUR")).toEqual({ ok: true, value: 123456 });
    expect(parseMoneyInput("19,99 €", "EUR")).toEqual({ ok: true, value: 1999 });
  });
});

describe("round trip", () => {
  it("survives parse -> input string -> parse", () => {
    for (const input of ["0.01", "12.34", "1234.56", "-9.99", "1000000.00"]) {
      const parsed = parseMoneyInput(input, "EUR");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const text = minorToInputString(parsed.value, "EUR");
      const again = parseMoneyInput(text, "EUR");
      expect(again).toEqual({ ok: true, value: parsed.value });
    }
  });

  it("formats zero-decimal currencies without a decimal point", () => {
    expect(minorToInputString(toMinor(1200), "JPY")).toBe("1200");
  });
});

describe("convertToBase", () => {
  it("is exact at a 1:1 rate", () => {
    expect(convertToBase(toMinor(12345), ONE_TO_ONE)).toBe(12345);
  });

  it("applies a rate and rounds half away from zero", () => {
    // 248000 minor CZK at 0.0398 = 9870.4 -> 9870
    expect(convertToBase(toMinor(248_000), toScaledRate(0.0398))).toBe(9870);
    // 5 at 0.5 = 2.5 -> 3 (half away from zero, not banker's rounding)
    expect(convertToBase(toMinor(5), toScaledRate(0.5))).toBe(3);
  });

  it("rounds negatives symmetrically", () => {
    expect(convertToBase(toMinor(-5), toScaledRate(0.5))).toBe(-3);
    expect(convertToBase(negateMinor(toMinor(248_000)), toScaledRate(0.0398))).toBe(
      -9870,
    );
  });

  it("stays exact for large amounts where float would drift", () => {
    const result = convertToBase(toMinor(999_999_999), toScaledRate(1.5));
    expect(result).toBe(1_499_999_999);
    expect(Number.isSafeInteger(result)).toBe(true);
  });
});

describe("parseRateInput", () => {
  it("accepts decimal rates with either separator", () => {
    expect(parseRateInput("24.35")).toEqual({ ok: true, value: 24_350_000_000 });
    expect(parseRateInput("24,35")).toEqual({ ok: true, value: 24_350_000_000 });
  });

  it("rejects zero, negatives and junk", () => {
    expect(parseRateInput("0").ok).toBe(false);
    expect(parseRateInput("-1").ok).toBe(false);
    expect(parseRateInput("abc").ok).toBe(false);
  });
});

describe("percentOf", () => {
  it("returns zero rather than dividing by zero", () => {
    expect(percentOf(toMinor(100), toMinor(0))).toBe(0);
  });

  it("computes a share", () => {
    expect(percentOf(toMinor(50), toMinor(200))).toBe(25);
  });
});

describe("toMinor", () => {
  it("refuses non-integers and unsafe values", () => {
    expect(() => toMinor(1.5)).toThrow(RangeError);
    expect(() => toMinor(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => toMinor(Number.NaN)).toThrow(RangeError);
  });
});
