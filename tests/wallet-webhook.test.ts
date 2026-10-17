import { describe, expect, it } from "vitest";
import { bearerToken, parseWalletPayload, secretHint } from "@/lib/wallet-webhook";

const BASE = "EUR";

function valid(overrides: Record<string, unknown> = {}): unknown {
  return {
    email: "someone@example.com",
    amount: "12,50 €",
    merchant: "NAKUP KARTOU LIDL BRATISLAVA",
    account: "Tatra banka",
    ...overrides,
  };
}

describe("parseWalletPayload", () => {
  it("parses a localized Apple Pay amount into minor units", () => {
    const result = parseWalletPayload(valid(), BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.amountMinor).toBe(1250);
  });

  it("accepts plain decimal amounts and symbol-first strings", () => {
    for (const amount of ["3.20", "€3.20", "3,20"]) {
      const result = parseWalletPayload(valid({ amount }), BASE);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.amountMinor).toBe(320);
    }
  });

  it("treats the amount as a magnitude regardless of sign", () => {
    const result = parseWalletPayload(valid({ amount: "-12,50 €" }), BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.amountMinor).toBe(1250);
  });

  it("rejects a zero amount", () => {
    const result = parseWalletPayload(valid({ amount: "0" }), BASE);
    expect(result.ok).toBe(false);
  });

  it("rejects an unreadable amount", () => {
    const result = parseWalletPayload(valid({ amount: "sushi" }), BASE);
    expect(result.ok).toBe(false);
  });

  it("recognises the merchant and suggests its category", () => {
    const result = parseWalletPayload(valid(), BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.merchant).toBe("Lidl");
    expect(result.value.categorySlug).toBe("groceries");
    expect(result.value.categoryName).toBe("Potraviny");
  });

  it("keeps the raw merchant when nothing matches", () => {
    const result = parseWalletPayload(
      valid({ merchant: "  Ramen Bar Hachi  " }),
      BASE,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.merchant).toBe("Ramen Bar Hachi");
    expect(result.value.categorySlug).toBeNull();
    expect(result.value.categoryName).toBeNull();
  });

  it("requires a merchant", () => {
    expect(parseWalletPayload(valid({ merchant: "  " }), BASE).ok).toBe(false);
    expect(parseWalletPayload(valid({ merchant: undefined }), BASE).ok).toBe(
      false,
    );
  });

  it("lowercases and requires the member email", () => {
    const result = parseWalletPayload(
      valid({ email: " Someone@Example.COM " }),
      BASE,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.email).toBe("someone@example.com");
    expect(parseWalletPayload(valid({ email: "" }), BASE).ok).toBe(false);
    expect(parseWalletPayload(valid({ email: undefined }), BASE).ok).toBe(
      false,
    );
  });

  it("accepts the base currency in any case and rejects others", () => {
    const ok = parseWalletPayload(valid({ currency: "eur" }), BASE);
    expect(ok.ok).toBe(true);

    const foreign = parseWalletPayload(valid({ currency: "CZK" }), BASE);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toContain("CZK");
  });

  it("treats a blank account as absent", () => {
    const result = parseWalletPayload(valid({ account: "  " }), BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.account).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseWalletPayload(null, BASE).ok).toBe(false);
    expect(parseWalletPayload("12,50", BASE).ok).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token whatever the scheme's case", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("  BEARER   abc123  ")).toBe("abc123");
  });

  it("refuses anything that is not a single bearer token", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer two tokens")).toBeNull();
  });
});

describe("secretHint", () => {
  it("shows only the last four characters", () => {
    expect(secretHint("abcdefghijklmnop")).toBe("mnop");
  });
});
