import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  households,
  transactions,
  users,
} from "@/db/schema";
import { todayISO } from "@/lib/date";
import { ONE_TO_ONE, negateMinor } from "@/lib/money";
import {
  authenticateWalletToken,
  recordWalletError,
  recordWalletReceipt,
} from "@/lib/wallet";
import { bearerToken, parseWalletPayload } from "@/lib/wallet-webhook";


function reject(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Records an Apple Pay charge sent by an iOS Shortcuts "Transaction"
 * automation. The shortcut posts { email, amount, merchant, account? } with
 * a bearer secret; the expense lands on the named account — or the household's
 * default — categorised via the merchant catalogue when the terminal string is
 * recognised.
 *
 * Two secrets are accepted: the household's own (rotated from the Apple Pay
 * screen, stored hashed) and WALLET_WEBHOOK_SECRET, kept so a shortcut set up
 * before rotation existed carries on working. A household secret also pins the
 * household, so the email must belong to it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const now = new Date();
  const authResult = await authenticateWalletToken(
    bearerToken(request.headers.get("authorization")),
  );

  if (!authResult.ok) {
    return authResult.reason === "unconfigured"
      ? reject(503, "No webhook secret is configured — rotate one in the app")
      : reject(401, "Unauthorized");
  }

  // Known from the secret when it is the household's own; from the member
  // otherwise. Errors are recorded against it as soon as it is known.
  let householdId: string | null =
    authResult.via === "db" ? authResult.householdId : null;

  async function refuse(status: number, error: string): Promise<NextResponse> {
    if (householdId !== null) await recordWalletError(householdId, error, now);
    return reject(status, error);
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return refuse(400, "Body is not valid JSON");
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return refuse(400, "Expected a JSON object");
  }

  // The email decides whose expense it is — and which household's base
  // currency the amount is parsed against — so the member is looked up first.
  const rawEmail = (json as Record<string, unknown>).email;
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

  const memberRows = await db
    .select({
      id: users.id,
      householdId: users.householdId,
      baseCurrency: households.baseCurrency,
    })
    .from(users)
    .innerJoin(households, eq(households.id, users.householdId))
    .where(
      and(
        eq(users.email, email),
        householdId === null ? undefined : eq(users.householdId, householdId),
      ),
    )
    .limit(1);

  const member = memberRows[0];
  if (member?.householdId == null) {
    return refuse(422, `No household member with email "${email}"`);
  }
  householdId = member.householdId;

  const parsed = parseWalletPayload(json, member.baseCurrency);
  if (!parsed.ok) return refuse(422, parsed.error);
  const payload = parsed.value;

  // The flagged default first, then display order — the same fallback
  // getDefaultAccount uses, so the settings screen names the right account.
  const activeAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)),
    )
    .orderBy(
      desc(accounts.isDefault),
      asc(accounts.sortOrder),
      asc(accounts.createdAt),
    );

  let account = activeAccounts[0];
  if (payload.account !== null) {
    const wanted = payload.account.toLowerCase();
    account = activeAccounts.find((row) => row.name.toLowerCase() === wanted);
  }
  if (!account) {
    const names = activeAccounts.map((row) => row.name).join(", ");
    return refuse(
      422,
      `No account named "${payload.account ?? ""}" — available: ${names}`,
    );
  }

  // The catalogue key matches the slug on shipped category rows, so the
  // lookup survives renames into any interface language; the catalogue's
  // display name is only a fallback for households that built their own.
  let categoryId: string | null = null;
  if (payload.categorySlug !== null) {
    const categoryRows = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.kind, "expense"),
          isNull(categories.archivedAt),
          or(
            eq(categories.slug, payload.categorySlug),
            sql`lower(${categories.name}) = ${(payload.categoryName ?? "").toLowerCase()}`,
          ),
        ),
      )
      .limit(2);
    categoryId =
      (
        categoryRows.find((row) => row.slug === payload.categorySlug) ??
        categoryRows[0]
      )?.id ?? null;
  }

  const [created] = await db
    .insert(transactions)
    .values({
      householdId,
      accountId: account.id,
      categoryId,
      createdByUserId: member.id,
      paidByUserId: member.id,
      type: "expense",
      amountMinor: negateMinor(payload.amountMinor),
      currency: member.baseCurrency,
      fxRateToBase: ONE_TO_ONE,
      amountBaseMinor: negateMinor(payload.amountMinor),
      occurredOn: todayISO(now),
      // A tap is the one entry whose clock time is known exactly.
      occurredAt: now,
      merchant: payload.merchant,
      source: "apple_pay",
    })
    .returning({ id: transactions.id });

  if (created) await recordWalletReceipt(householdId, created.id, now);

  revalidatePath("/", "layout");

  return NextResponse.json({
    ok: true,
    id: created?.id,
    merchant: payload.merchant,
    // Kept for shortcuts built against the old response, which showed `note`.
    note: payload.merchant,
    account: account.name,
    categorized: categoryId !== null,
  });
}
