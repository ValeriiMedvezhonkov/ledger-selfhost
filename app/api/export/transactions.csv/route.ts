import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions, users } from "@/db/schema";
import { getVerifiedUser } from "@/lib/auth";
import { minorToInputString } from "@/lib/money";
import { toCsv, type ExportRow } from "@/lib/csv";


export async function GET(): Promise<NextResponse> {
  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      occurredOn: transactions.occurredOn,
      type: transactions.type,
      accountName: accounts.name,
      categoryName: categories.name,
      paidByName: users.displayName,
      paidByFallback: users.email,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      amountBaseMinor: transactions.amountBaseMinor,
      merchant: transactions.merchant,
      note: transactions.note,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(users, eq(transactions.paidByUserId, users.id))
    .where(eq(transactions.householdId, user.householdId))
    .orderBy(desc(transactions.occurredOn));

  const data: ExportRow[] = rows.map((row) => ({
    date: row.occurredOn,
    type: row.type,
    account: row.accountName,
    category: row.categoryName ?? "",
    paidBy: row.paidByName ?? row.paidByFallback ?? "",
    amount: minorToInputString(row.amountMinor, row.currency),
    currency: row.currency,
    amountBase: minorToInputString(row.amountBaseMinor, user.baseCurrency),
    merchant: row.merchant ?? "",
    note: row.note ?? "",
  }));

  return new NextResponse(toCsv(data), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ledger-transactions.csv"`,
      "cache-control": "no-store",
    },
  });
}
