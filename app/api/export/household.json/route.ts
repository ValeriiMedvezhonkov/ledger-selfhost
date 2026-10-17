import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  budgets,
  categories,
  goalContributions,
  goals,
  recurringRules,
  transactions,
} from "@/db/schema";
import { getVerifiedUser } from "@/lib/auth";


/** Full household dump. Deliberately raw — this is a backup, not a report. */
export async function GET(): Promise<NextResponse> {
  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = user.householdId;

  const [
    accountRows,
    categoryRows,
    transactionRows,
    budgetRows,
    recurringRows,
    goalRows,
  ] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.householdId, id)),
    db.select().from(categories).where(eq(categories.householdId, id)),
    db.select().from(transactions).where(eq(transactions.householdId, id)),
    db.select().from(budgets).where(eq(budgets.householdId, id)),
    db.select().from(recurringRules).where(eq(recurringRules.householdId, id)),
    db.select().from(goals).where(eq(goals.householdId, id)),
  ]);

  const contributionRows =
    goalRows.length === 0
      ? []
      : await db.select().from(goalContributions);

  const payload = {
    exportedAt: new Date().toISOString(),
    baseCurrency: user.baseCurrency,
    accounts: accountRows,
    categories: categoryRows,
    transactions: transactionRows,
    budgets: budgetRows,
    recurringRules: recurringRows,
    goals: goalRows,
    goalContributions: contributionRows.filter((row) =>
      goalRows.some((goal) => goal.id === row.goalId),
    ),
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ledger-export.json"`,
      "cache-control": "no-store",
    },
  });
}
