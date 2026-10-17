import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * Written out rather than pulled in: it is about sixty lines, the algorithm is
 * frozen by the RFC, and the official test vectors let it be proved correct
 * here instead of trusted. A dependency in the authentication path is worth
 * avoiding when the alternative is this small.
 */

/** Authenticator apps assume these; changing them breaks existing enrolments. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
const TOTP_ALGORITHM = "sha1";

/**
 * How many periods either side of now are accepted.
 *
 * One step — 30 seconds back and forward — absorbs ordinary clock drift and a
 * code typed as it rolls over. Wider would be kinder to bad clocks and would
 * also widen the window an intercepted code stays usable in.
 */
const SKEW_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, which is what authenticator apps expect. */
export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      // charAt, not [], because the mask already guarantees 0-31 but
      // noUncheckedIndexedAccess cannot see that.
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return output;
}

export function base32Decode(input: string): Buffer {
  // Authenticator apps show the secret in spaced groups, and padding is
  // optional in the wild; both are stripped rather than rejected.
  const cleaned = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** A fresh secret. 20 bytes is the RFC 4226 recommendation for SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The counter value for a moment in time. Exported so callers can store it. */
export function totpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** HOTP (RFC 4226) — the counter-based primitive TOTP is built on. */
export function hotp(
  secret: Buffer,
  counter: number,
  digits: number = TOTP_DIGITS,
  algorithm: string = TOTP_ALGORITHM,
): string {
  const message = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer. BigInt rather than bit shifts:
  // above 2^31 the shift operators wrap and silently produce wrong codes.
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** The code for a given secret at a given moment. */
export function totp(
  secret: string,
  atMs: number,
  digits: number = TOTP_DIGITS,
  algorithm: string = TOTP_ALGORITHM,
): string {
  return hotp(base32Decode(secret), totpStep(atMs), digits, algorithm);
}

export interface TotpVerification {
  readonly ok: boolean;
  /**
   * The step the code belongs to. Store it: rejecting a step that has already
   * been used is what stops the same code being replayed inside its 30-second
   * window, or by anyone who reads it over a shoulder.
   */
  readonly step: number | null;
}

export function verifyTotp(
  secret: string,
  code: string,
  atMs: number,
  lastUsedStep: number | null,
): TotpVerification {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d+$/.test(cleaned) || cleaned.length !== TOTP_DIGITS) {
    return { ok: false, step: null };
  }

  const current = totpStep(atMs);

  for (let offset = -SKEW_STEPS; offset <= SKEW_STEPS; offset += 1) {
    const step = current + offset;
    // A code from a step at or before the last accepted one is a replay, even
    // if it computes correctly.
    if (lastUsedStep !== null && step <= lastUsedStep) continue;

    const expected = hotp(base32Decode(secret), step);
    if (constantTimeEquals(expected, cleaned)) return { ok: true, step };
  }

  return { ok: false, step: null };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** The otpauth:// URI an authenticator app scans. */
export function totpUri(
  secret: string,
  accountEmail: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
