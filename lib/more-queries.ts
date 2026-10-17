import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, goals, recurringRules } from "@/db/schema";

/**
 * The counts on the Ещё screen («Цели 3», «Счета 3», «Категории 24»,
 * «Регулярные 4»). Household-scoped like everything in lib/queries.ts.
 *
 * Plain `count(*)`s rather than the list queries those screens use: the
 * lists join transactions for balances and usage, which is a lot of work to
 * throw away for four numbers. Archived rows are left out because the pushed
 * screens hide them by default, so the badge matches what the user lands on.
 */
export interface MoreCounts {
  readonly goals: number;
  readonly accounts: number;
  readonly categories: number;
  readonly recurring: number;
}

export async function getMoreCounts(householdId: string): Promise<MoreCounts> {
  const [goalRows, accountRows, categoryRows, recurringRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(goals)
      .where(and(eq(goals.householdId, householdId), isNull(goals.archivedAt))),
    db
      .select({ n: count() })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt))),
    db
      .select({ n: count() })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), isNull(categories.archivedAt))),
    db
      .select({ n: count() })
      .from(recurringRules)
      .where(eq(recurringRules.householdId, householdId)),
  ]);

  return {
    goals: goalRows[0]?.n ?? 0,
    accounts: accountRows[0]?.n ?? 0,
    categories: categoryRows[0]?.n ?? 0,
    recurring: recurringRows[0]?.n ?? 0,
  };
}
