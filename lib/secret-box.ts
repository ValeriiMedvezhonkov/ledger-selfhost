import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/env";

/**
 * Authenticated encryption for secrets that have to be stored and read back.
 *
 * A TOTP secret is not a password: the server must recover the original to
 * compute a code, so it cannot be hashed. Encrypting it means a leaked database
 * dump alone does not yield working second factors — an attacker needs
 * AUTH_SECRET from the environment as well.
 *
 * The key is derived from AUTH_SECRET rather than being another variable to
 * manage, with a distinct HKDF `info` so it can never collide with whatever
 * Auth.js derives from the same value.
 */
const KEY_INFO = "ledger:totp-secret:v1";
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

function key(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", env.AUTH_SECRET, "", KEY_INFO, 32),
  );
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null rather than throwing on anything malformed or tampered with.
 * A failed unseal means "this secret is unusable", which every caller has to
 * handle anyway — an exception here would surface as a 500 during sign-in.
 */
export function unseal(sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  const [, ivPart, tagPart, dataPart] = parts;
  if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    return null;
  }

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or the ciphertext was altered — GCM's tag check catches both.
    return null;
  }
}
