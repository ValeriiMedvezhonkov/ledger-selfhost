import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  totpStep,
  totpUri,
  TOTP_PERIOD_SECONDS,
  verifyTotp,
} from "@/lib/totp";

/** RFC 4648 §10. */
describe("base32", () => {
  it("matches the RFC test vectors", () => {
    const vectors: readonly [string, string][] = [
      ["", ""],
      ["f", "MY======"],
      ["fo", "MZXQ===="],
      ["foo", "MZXW6==="],
      ["foob", "MZXW6YQ="],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI======"],
    ];

    for (const [plain, encoded] of vectors) {
      // Padding is omitted on encode; compare against the unpadded form.
      expect(base32Encode(Buffer.from(plain))).toBe(encoded.replace(/=/g, ""));
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
  });

  it("round-trips random secrets", () => {
    for (let i = 0; i < 50; i += 1) {
      const secret = generateTotpSecret();
      expect(base32Encode(base32Decode(secret))).toBe(secret);
    }
  });

  it("tolerates the spacing and padding authenticator apps display", () => {
    expect(base32Decode("MZXW 6YTB").toString()).toBe("fooba");
    expect(base32Decode("mzxw6ytb").toString()).toBe("fooba");
  });
});

/** RFC 4226 Appendix D — secret "12345678901234567890", counters 0-9. */
describe("HOTP (RFC 4226)", () => {
  it("matches the published vectors", () => {
    const secret = Buffer.from("12345678901234567890");
    const expected = [
      "755224", "287082", "359152", "969429", "338314",
      "254676", "287922", "162583", "399871", "520489",
    ];

    expected.forEach((code, counter) => {
      expect(hotp(secret, counter), `counter ${String(counter)}`).toBe(code);
    });
  });
});

/**
 * RFC 6238 Appendix B. The vectors are 8-digit SHA-1 codes over the ASCII
 * secret "12345678901234567890" — the widest check available of the counter
 * maths, including values past 2^31 where a 32-bit shift would silently wrap.
 */
describe("TOTP (RFC 6238)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the published vectors", () => {
    const vectors: readonly [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];

    for (const [seconds, code] of vectors) {
      expect(totp(secret, seconds * 1000, 8), `t=${String(seconds)}`).toBe(code);
    }
  });

  it("advances the code every 30 seconds and holds it in between", () => {
    // Aligned to the start of a step. An arbitrary timestamp is usually
    // mid-step, so "+29s" would cross a boundary and the test would be
    // asserting the wrong thing.
    const base = totpStep(1_700_000_000_000) * TOTP_PERIOD_SECONDS * 1000;
    expect(totp(secret, base)).toBe(totp(secret, base + 29_000));
    expect(totp(secret, base)).not.toBe(totp(secret, base + 31_000));
  });
});

describe("verification", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it("accepts the current code", () => {
    const result = verifyTotp(secret, totp(secret, now), now, null);
    expect(result.ok).toBe(true);
    expect(result.step).toBe(totpStep(now));
  });

  it("accepts one step of clock drift either way", () => {
    expect(verifyTotp(secret, totp(secret, now - 30_000), now, null).ok).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now, null).ok).toBe(true);
  });

  it("rejects drift beyond the window", () => {
    expect(verifyTotp(secret, totp(secret, now - 90_000), now, null).ok).toBe(false);
    expect(verifyTotp(secret, totp(secret, now + 90_000), now, null).ok).toBe(false);
  });

  it("refuses a code that has already been used", () => {
    const code = totp(secret, now);
    const first = verifyTotp(secret, code, now, null);
    expect(first.ok).toBe(true);

    // Same code, same 30-second window, but the step is now spent.
    expect(verifyTotp(secret, code, now, first.step).ok).toBe(false);
  });

  it("refuses an older code once a newer one has been used", () => {
    const used = totpStep(now);
    expect(verifyTotp(secret, totp(secret, now - 30_000), now, used).ok).toBe(false);
  });

  it("still accepts the next code after one is spent", () => {
    const used = totpStep(now);
    const later = now + 30_000;
    expect(verifyTotp(secret, totp(secret, later), later, used).ok).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78", "٧٢٣٤٥٦"]) {
      expect(verifyTotp(secret, bad, now, null).ok, bad).toBe(false);
    }
  });

  it("rejects a code computed from a different secret", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(secret, totp(other, now), now, null).ok).toBe(false);
  });
});

describe("enrolment URI", () => {
  it("carries the parameters an authenticator needs", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "someone@example.com", "Ledger");
    expect(uri).toContain("otpauth://totp/Ledger%3Asomeone%40example.com");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
