import { describe, expect, it } from "vitest";
import {
  CATEGORY_BY_MERCHANT,
  MERCHANTS,
  MERCHANT_NAMES,
  SK_CATEGORIES,
  matchMerchant,
  normalizeDescription,
  skCategoryKeyForName,
} from "@/lib/merchants";

describe("normalizeDescription", () => {
  it("strips diacritics so Slovak names match their ASCII spelling", () => {
    expect(normalizeDescription("REŠTAURÁCIA")).toBe("restauracia");
    expect(normalizeDescription("Lekáreň Dr.Max")).toBe("lekaren dr max");
    expect(normalizeDescription("Nájom")).toBe("najom");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeDescription("DR.MAX   LEKAREN,  AUPARK")).toBe(
      "dr max lekaren aupark",
    );
    expect(normalizeDescription("1234****5678 LIDL SK")).toBe("1234 5678 lidl sk");
  });
});

describe("matchMerchant", () => {
  it("finds a merchant inside a real card-payment description", () => {
    const match = matchMerchant("NAKUP KARTOU 1234****5678 LIDL SK 0521 BRATISLAVA");
    expect(match?.merchant).toBe("Lidl");
    expect(match?.categoryName).toBe(SK_CATEGORIES.groceries);
  });

  it("handles the legal-entity suffixes banks include", () => {
    expect(matchMerchant("TESCO STORES SR A.S. PETRZALKA")?.merchant).toBe("Tesco");
    expect(matchMerchant("ZSE ENERGIA A.S. ZALOHA")?.merchant).toBe("ZSE Energia");
  });

  it("prefers the more specific rule — Tesco Mobile is not groceries", () => {
    const match = matchMerchant("TESCO MOBILE DOBITIE KREDITU");
    expect(match?.merchant).toBe("Tesco Mobile");
    expect(match?.categoryName).toBe(SK_CATEGORIES.telecom);
  });

  it("matches regardless of diacritics in the source string", () => {
    expect(matchMerchant("REŠTAURÁCIA U SUSEDA")?.categoryName).toBe(
      SK_CATEGORIES.restaurants,
    );
    expect(matchMerchant("LEKÁREŇ BENU")?.categoryName).toBe(SK_CATEGORIES.health);
  });

  it("recognises the usual Slovak suspects", () => {
    const cases: readonly [string, string][] = [
      ["PLATBA KARTOU DM DROGERIE MARKT SK", SK_CATEGORIES.drugstore],
      ["SLOVNAFT CS BRATISLAVA", SK_CATEGORIES.fuel],
      ["WOLT SLOVAKIA", SK_CATEGORIES.restaurants],
      ["ALZA.SK OBJEDNAVKA", SK_CATEGORIES.electronics],
      ["DPB PREDPLATNY LISTOK", SK_CATEGORIES.transport],
      ["KAUFLAND 1234", SK_CATEGORIES.groceries],
      ["MARTINUS KNIHY", SK_CATEGORIES.entertainment],
      ["DECATHLON BORY MALL", SK_CATEGORIES.sport],
      ["IKEA BRATISLAVA", SK_CATEGORIES.home],
      ["ALLIANZ SP POISTNE", SK_CATEGORIES.insurance],
    ];

    for (const [description, expected] of cases) {
      expect(matchMerchant(description)?.categoryName, description).toBe(expected);
    }
  });

  it("returns null rather than guessing at an unknown merchant", () => {
    expect(matchMerchant("NIECO UPLNE NEZNAME XYZ")).toBeNull();
    expect(matchMerchant("")).toBeNull();
  });
});

describe("catalogue integrity", () => {
  it("exposes a deduplicated, sorted name list", () => {
    expect(new Set(MERCHANT_NAMES).size).toBe(MERCHANT_NAMES.length);
    expect(MERCHANT_NAMES.length).toBeGreaterThan(80);
  });

  it("maps every merchant to a category", () => {
    for (const name of MERCHANT_NAMES) {
      expect(CATEGORY_BY_MERCHANT.get(name), name).toBeTruthy();
    }
  });

  it("normalises punctuation so DR.MAX, Dr. Max and dr max all agree", () => {
    const forms = ["DR.MAX", "Dr. Max", "dr max", "DR . MAX"];
    const normalised = new Set(forms.map(normalizeDescription));
    expect([...normalised]).toEqual(["dr max"]);
    for (const form of forms) {
      expect(matchMerchant(form)?.merchant, form).toBe("Dr. Max");
    }
  });

  it("gives every merchant an exact category, including the 14 whose needle is longer than their name", () => {
    // "Metro" matches on "metro cash" so a bare "metro" cannot over-match; the
    // fuzzy matcher therefore cannot resolve its own display name. Picking it
    // from the combobox must still categorise, which is what this map is for.
    for (const name of ["Metro", "MOL", "Union", "VÚB", "Steam", "CBA"]) {
      expect(CATEGORY_BY_MERCHANT.get(name), name).toBeTruthy();
    }
    for (const name of MERCHANT_NAMES) {
      expect(CATEGORY_BY_MERCHANT.get(name), name).toBeTruthy();
    }
  });

  it("has no empty match patterns, which would match everything", () => {
    for (const rule of MERCHANTS) {
      expect(rule.match.length, rule.merchant).toBeGreaterThan(0);
      for (const needle of rule.match) {
        expect(normalizeDescription(needle).length, rule.merchant).toBeGreaterThan(0);
      }
    }
  });
});

describe("category keys are slugs, not display names", () => {
  // Auto-categorisation matches a category by slug, because display names now
  // follow the interface language. If these two ever drift apart, typing a
  // known merchant silently stops selecting anything — no error, just nothing.
  it("maps every merchant to a key that exists in the shipped catalogue", () => {
    const keys = new Set(Object.keys(SK_CATEGORIES));
    const strays = [...CATEGORY_BY_MERCHANT.entries()]
      .filter(([, key]) => !keys.has(key))
      .map(([merchant, key]) => `${merchant} → ${key}`);

    expect(strays).toEqual([]);
  });

  it("maps a known merchant to its key rather than a Slovak name", () => {
    expect(CATEGORY_BY_MERCHANT.get("Lidl")).toBe("groceries");
    expect(CATEGORY_BY_MERCHANT.get("Dr. Max")).toBe("health");
  });
});

describe("skCategoryKeyForName", () => {
  // Import resolves a recognised merchant's category through this key, so a
  // household whose categories are stored in Russian («Продукты») still gets
  // groceries for Lidl. Before, the Slovak name matched nothing and every
  // imported row landed uncategorised.
  it("maps catalogue names to their slug, case-insensitively", () => {
    expect(skCategoryKeyForName("Potraviny")).toBe("groceries");
    expect(skCategoryKeyForName("palivo")).toBe("fuel");
  });

  it("returns null for names outside the catalogue", () => {
    expect(skCategoryKeyForName("Продукты")).toBeNull();
  });
});
