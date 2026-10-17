import { describe, expect, it } from "vitest";
import {
  checkPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/lib/password";

describe("password hashing", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never produces the same hash twice", async () => {
    // A per-password salt is what stops one leaked hash revealing that two
    // accounts share a password, and stops precomputed tables working at all.
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("carries its parameters, so they can be raised later", async () => {
    const hash = await hashPassword("whatever");
    const [prefix, n, r, p] = hash.split("$");
    expect(prefix).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it("still verifies a hash made with weaker parameters", async () => {
    // Simulates a hash from an older deployment: the stored parameters are
    // used, not the current ones, or every password would break on an upgrade.
    const weak = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2E$" + "x".repeat(10);
    expect(await verifyPassword("anything", weak)).toBe(false);
    expect(needsRehash(weak)).toBe(true);

    const current = await hashPassword("anything");
    expect(needsRehash(current)).toBe(false);
  });

  it("treats a malformed hash as a failed login, not an error", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$1$2$3",
      "argon2$65536$8$1$c2FsdA$aGFzaA",
      "scrypt$abc$8$1$c2FsdA$aGFzaA",
    ]) {
      await expect(verifyPassword("password", bad)).resolves.toBe(false);
    }
  });

  it("refuses parameters that would exhaust memory", async () => {
    // Otherwise anyone able to write the column could turn a login attempt
    // into an out-of-memory kill.
    const hostile = `scrypt$${String(2 ** 30)}$8$1$c2FsdA$aGFzaA`;
    await expect(verifyPassword("password", hostile)).resolves.toBe(false);
  });

  it("normalises unicode, so the same typed password matches", async () => {
    // "é" composed vs decomposed looks identical and arrives differently
    // depending on the keyboard and platform.
    const composed = "café password long";
    const decomposed = "café password long";
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe("password rules", () => {
  it("requires length and nothing else", () => {
    expect(checkPassword("short")).toEqual({ key: "passwordTooShort" });
    expect(checkPassword("a".repeat(11))).toEqual({ key: "passwordTooShort" });
    expect(checkPassword("a".repeat(12))).toBeNull();
    // No composition rules: a long passphrase of plain words is fine.
    expect(checkPassword("correct horse battery staple")).toBeNull();
    expect(checkPassword("a".repeat(201))).toEqual({ key: "passwordTooLong" });
  });
});
