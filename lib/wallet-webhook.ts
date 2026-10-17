import { absMinor, isZero, parseMoneyInput, type Minor } from "@/lib/money";
import { matchMerchant, type SkCategoryKey } from "@/lib/merchants";

/**
 * Payload sent by the iOS Shortcuts "Transaction" automation when a card is
 * tapped with Apple Pay. Shortcuts renders the amount as a localized string
 * ("12,50 €") and the merchant as whatever the terminal reported, so parsing
 * here is deliberately tolerant. Kept free of database and environment
 * imports so it stays unit-testable; the route does the lookups.
 */
export interface WalletPayload {
  /** Household member the expense is attributed to, lowercased. */
  readonly email: string;
  /** Positive magnitude in base-currency minor units. */
  readonly amountMinor: Minor;
  /**
   * Canonical merchant name when recognised, else the raw string. Written to
   * the row's `merchant` — the title — since migration 0010 split it from the
   * free-text note.
   */
  readonly merchant: string;
  /**
   * Category key from the merchant catalogue, or null when unknown. The keys
   * double as the stable slugs on shipped category rows, so matching by slug
   * works whatever language the household renamed nothing in.
   */
  readonly categorySlug: SkCategoryKey | null;
  /** Catalogue display name, a fallback for self-made categories. */
  readonly categoryName: string | null;
  /** Account name configured in the shortcut, or null to use the default. */
  readonly account: string | null;
}

export type WalletParseResult =
  | { readonly ok: true; readonly value: WalletPayload }
  | { readonly ok: false; readonly error: string };

function fail(error: string): WalletParseResult {
  return { ok: false, error };
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseWalletPayload(
  input: unknown,
  baseCurrency: string,
): WalletParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("Expected a JSON object");
  }
  const body = input as Record<string, unknown>;

  const email = asTrimmedString(body.email).toLowerCase();
  if (email === "") return fail("Missing 'email' — set it in the shortcut");

  const merchant = asTrimmedString(body.merchant);
  if (merchant === "") return fail("Missing 'merchant'");

  // Wallet reports the local charge; only the household's base currency can
  // be recorded without an exchange rate, so anything else is refused loudly
  // and the payment is added by hand.
  const currency = asTrimmedString(body.currency).toUpperCase();
  if (currency !== "" && currency !== baseCurrency) {
    return fail(
      `Currency ${currency} is not the base currency ${baseCurrency} — add this payment manually`,
    );
  }

  const rawAmount = asTrimmedString(body.amount);
  const parsed = parseMoneyInput(rawAmount, baseCurrency);
  if (!parsed.ok) return fail(`Unreadable amount "${rawAmount}"`);
  if (isZero(parsed.value)) return fail("Amount is zero");

  const matched = matchMerchant(merchant);
  const account = asTrimmedString(body.account);

  return {
    ok: true,
    value: {
      email,
      // The trigger fires on charges; sign conventions vary by card, so the
      // magnitude is what counts and the route writes it as an expense.
      amountMinor: absMinor(parsed.value),
      merchant: matched?.merchant ?? merchant,
      categorySlug: matched?.category ?? null,
      categoryName: matched?.categoryName ?? null,
      account: account === "" ? null : account,
    },
  };
}

/**
 * The token from an `Authorization: Bearer …` header, or null. The scheme is
 * case-insensitive per RFC 7235; Shortcuts users type it by hand.
 */
export function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * What the settings screen shows of a secret it can no longer read: the last
 * four characters, enough to tell which one a phone still has configured.
 */
export function secretHint(secret: string): string {
  return secret.slice(-4);
}
