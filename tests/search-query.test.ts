import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@/lib/search-query";

describe("parseSearchQuery", () => {
  it("leaves plain text alone", () => {
    expect(parseSearchQuery("  lidl   bratislava ")).toEqual({
      text: "lidl bratislava",
      amount: null,
    });
  });

  it("reads greater-than with and without a space", () => {
    for (const q of [">50", "> 50"]) {
      expect(parseSearchQuery(q)).toEqual({
        text: "",
        amount: { op: "gt", minMinor: 5000 },
      });
    }
  });

  it("tolerates a currency symbol or code on either side", () => {
    for (const q of [">50 €", ">50€", ">€50", "> 50 eur", ">50 EUR"]) {
      expect(parseSearchQuery(q).amount).toEqual({ op: "gt", minMinor: 5000 });
      expect(parseSearchQuery(q).text).toBe("");
    }
  });

  it("reads less-than", () => {
    expect(parseSearchQuery("<20").amount).toEqual({ op: "lt", maxMinor: 2000 });
  });

  it("reads exact amounts with a decimal comma", () => {
    expect(parseSearchQuery("=12,50").amount).toEqual({
      op: "eq",
      minMinor: 1250,
      maxMinor: 1250,
    });
  });

  it("reads inclusive ranges, including phone-substituted dashes", () => {
    for (const q of ["10-30", "10 - 30", "10–30 €"]) {
      expect(parseSearchQuery(q)).toEqual({
        text: "",
        amount: { op: "between", minMinor: 1000, maxMinor: 3000 },
      });
    }
  });

  it("combines text with an amount", () => {
    expect(parseSearchQuery("lidl >20")).toEqual({
      text: "lidl",
      amount: { op: "gt", minMinor: 2000 },
    });
    expect(parseSearchQuery(">20 lidl")).toEqual({
      text: "lidl",
      amount: { op: "gt", minMinor: 2000 },
    });
  });

  it("keeps only the first amount and drops the rest from the text", () => {
    expect(parseSearchQuery(">20 <50 wolt")).toEqual({
      text: "wolt",
      amount: { op: "gt", minMinor: 2000 },
    });
  });

  it("does not treat a reversed range as an amount", () => {
    expect(parseSearchQuery("2026-08")).toEqual({ text: "2026-08", amount: null });
  });

  it("does not read numbers glued to words", () => {
    expect(parseSearchQuery("bistro>20x")).toEqual({
      text: "bistro>20x",
      amount: null,
    });
    expect(parseSearchQuery("O2 paušál").amount).toBeNull();
  });

  it("does not eat a word that merely follows the number", () => {
    expect(parseSearchQuery("> 20 bar")).toEqual({
      text: "bar",
      amount: { op: "gt", minMinor: 2000 },
    });
  });

  it("respects the currency's decimals", () => {
    expect(parseSearchQuery(">1500", "JPY").amount).toEqual({
      op: "gt",
      minMinor: 1500,
    });
    // Three decimals are not a valid EUR amount, so this stays text.
    expect(parseSearchQuery("=1,2345").amount).toBeNull();
  });
});
