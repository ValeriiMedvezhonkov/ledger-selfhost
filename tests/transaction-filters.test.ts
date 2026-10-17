import { describe, expect, it } from "vitest";
import { avatarEmoji, transactionFilterSchema } from "@/lib/validations";

const A = "0b6f3b0e-4a41-4c55-8f0a-2f8a3c1d9e01";
const B = "4c2e9d7a-1b3f-4e8a-9c6d-5f1a2b3c4d5e";

describe("transactionFilterSchema.categoryIds", () => {
  it("defaults to an empty list", () => {
    expect(transactionFilterSchema.parse({}).categoryIds).toEqual([]);
  });

  it("accepts a repeated query parameter", () => {
    expect(transactionFilterSchema.parse({ categoryIds: [A, B] }).categoryIds).toEqual([A, B]);
  });

  it("accepts a comma-separated string and de-duplicates", () => {
    expect(
      transactionFilterSchema.parse({ categoryIds: `${A}, ${B},${A}` }).categoryIds,
    ).toEqual([A, B]);
  });

  it("rejects anything that is not a uuid", () => {
    expect(transactionFilterSchema.safeParse({ categoryIds: "lidl" }).success).toBe(false);
  });

  it("keeps the single categoryId working alongside", () => {
    const parsed = transactionFilterSchema.parse({ categoryId: A, categoryIds: B });
    expect(parsed.categoryId).toBe(A);
    expect(parsed.categoryIds).toEqual([B]);
  });
});

describe("avatarEmoji", () => {
  it("accepts one emoji, including multi-code-point ones", () => {
    for (const value of ["🐻", "🐒", "👍🏽", "👩‍👩‍👧", "🇸🇰"]) {
      expect(avatarEmoji.safeParse(value).success).toBe(true);
    }
  });

  it("refuses text, digits and more than one emoji", () => {
    for (const value of ["", "a", "1", "🐻🐻", "🐻 "]) {
      expect(avatarEmoji.safeParse(value).success).toBe(false);
    }
  });
});
