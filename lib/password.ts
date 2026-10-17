import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

/**
 * Wrapped by hand rather than with `promisify`, which loses the overload that
 * takes options — and the options are the cost parameters, which are the whole
 * point.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt because Node ships it: Argon2id would be the modern first choice, but
 * it means a native dependency in the authentication path, and scrypt is a
 * memory-hard KDF that OWASP still lists as acceptable. The difference matters
 * far less than the parameters below.
 */

/**
 * Cost parameters. N is the memory/time knob — memory used is roughly
 * 128 × N × r, so 2^16 is about 64 MB and a tenth of a second per attempt.
 * High enough to make offline guessing expensive, low enough that a small
 * server does not fall over when two people sign in at once.
 */
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** scrypt refuses to allocate this much by default. */
const MAX_MEM = 256 * 1024 * 1024;

const PREFIX = "scrypt";

/**
 * `scrypt$N$r$p$salt$hash`, all base64url.
 *
 * Self-describing on purpose: the parameters travel with the hash, so they can
 * be raised later without invalidating existing passwords. A stored hash is
 * verified with the parameters it was made with, and can be re-hashed with the
 * current ones on the next successful sign-in.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return [
    PREFIX,
    String(N),
    String(R),
    String(P),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted or
 * truncated column should read as "wrong password", not as a crash on the login
 * page that tells an attacker something the correct password would not.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;

  const [prefix, n, r, p, saltPart, hashPart] = parts;
  if (prefix !== PREFIX) return false;
  if (
    n === undefined ||
    r === undefined ||
    p === undefined ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  const cost = Number(n);
  const blockSize = Number(r);
  const parallelism = Number(p);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }
  // A hash claiming absurd parameters would otherwise let anyone who can write
  // to the column turn a login attempt into an out-of-memory kill.
  if (cost > 2 ** 20 || blockSize > 32 || parallelism > 16) return false;

  try {
    const salt = Buffer.from(saltPart, "base64url");
    const expected = Buffer.from(hashPart, "base64url");

    const derived = await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEM },
    );

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a hash was made with weaker parameters than the current ones. */
export function needsRehash(stored: string): boolean {
  const [prefix, n, r, p] = stored.split("$");
  return (
    prefix !== PREFIX ||
    Number(n) < N ||
    Number(r) < R ||
    Number(p) !== P
  );
}

export interface PasswordProblem {
  readonly key: string;
}

/**
 * The only rule is length.
 *
 * Composition rules — a digit, a symbol, mixed case — push people towards
 * `Password1!` and are no longer recommended by NIST. Length is what actually
 * buys entropy, and a second factor is available for anyone who wants more.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function checkPassword(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return { key: "passwordTooShort" };
  if (password.length > 200) return { key: "passwordTooLong" };
  return null;
}
