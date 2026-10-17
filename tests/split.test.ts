import { describe, expect, it } from "vitest";
import { splitMinor, toMinor } from "@/lib/money";

describe("splitMinor", () => {
  it("halves an even amount exactly", () => {
    expect(splitMinor(toMinor(2000))).toEqual([1000, 1000]);
  });

  it("gives the odd cent to the first half", () => {
    expect(splitMinor(toMinor(1001))).toEqual([501, 500]);
    expect(splitMinor(toMinor(1))).toEqual([1, 0]);
  });

  it("keeps the sign on both halves of an expense", () => {
    expect(splitMinor(toMinor(-1001))).toEqual([-501, -500]);
    expect(splitMinor(toMinor(-2))).toEqual([-1, -1]);
  });

  it("always sums back to the original", () => {
    for (const value of [0, 1, 2, 3, 99, 12345, -7, -12345]) {
      const [a, b] = splitMinor(toMinor(value));
      expect(a + b).toBe(value);
    }
  });

  it("never produces negative zero", () => {
    const [, b] = splitMinor(toMinor(-1));
    expect(Object.is(b, -0)).toBe(false);
  });
});
