import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { recurringRules, transactions } from "@/db/schema";
import { ONE_TO_ONE, convertToBase, toScaledRate } from "@/lib/money";
import { advanceByFrequency, compareISO, type ISODate } from "@/lib/date";

/**
 * Turn due recurring rules into real transactions.
 *
 * Called from the dashboard on load *and* from a daily cron, so it must be
 * idempotent: the rule row is locked FOR UPDATE and re-read inside the same
 * database transaction that inserts and advances `next_run_on`. Two concurrent
 * callers therefore serialise, and the second sees the already-advanced date and
 * does nothing. Running it twice in a row produces no duplicates.
 */

/** Hard stop so a rule with a far-past start date cannot spin forever. */
const MAX_OCCURRENCES_PER_RUN = 400;

export interface MaterializeResult {
  readonly created: number;
  readonly rulesAdvanced: number;
}

/**
 * What these rules cost per month, on average: 30.44 days, 4.33 weeks. Used
 * by the page subtitle; paused rules cost nothing.
 */
export function monthlyRateMinor(
  rules: readonly {
    readonly amountMinor: number;
    readonly frequency: string;
    readonly interval: number;
    readonly active: boolean;
  }[],
): number {
  return rules.reduce((sum, rule) => {
    if (!rule.active) return sum;
    const perMonth =
      rule.frequency === "daily"
        ? 30.44 / rule.interval
        : rule.frequency === "weekly"
          ? 4.33 / rule.interval
          : rule.frequency === "yearly"
            ? 1 / (12 * rule.interval)
            : 1 / rule.interval;
    return sum + Math.abs(rule.amountMinor) * perMonth;
  }, 0);
}

export async function materializeRecurring(
  householdId: string,
  asOf: ISODate,
  baseCurrency: string,
): Promise<MaterializeResult> {
  const due = await db
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        eq(recurringRules.active, true),
        lte(recurringRules.nextRunOn, asOf),
      ),
    );

  let created = 0;
  let rulesAdvanced = 0;

  for (const { id } of due) {
    const result = await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(recurringRules)
        .where(
          and(
            eq(recurringRules.id, id),
            eq(recurringRules.householdId, householdId),
          ),
        )
        .limit(1)
        .for("update");

      const rule = locked[0];
      if (!rule?.active) return 0;

      let cursor: ISODate = rule.nextRunOn;
      let inserted = 0;

      while (
        compareISO(cursor, asOf) <= 0 &&
        inserted < MAX_OCCURRENCES_PER_RUN
      ) {
        if (rule.endOn !== null && compareISO(cursor, rule.endOn) > 0) break;

        const rate =
          rule.currency === baseCurrency ? ONE_TO_ONE : toScaledRate(1);

        await tx.insert(transactions).values({
          householdId,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          createdByUserId: rule.paidByUserId,
          paidByUserId: rule.paidByUserId,
          type: rule.type,
          amountMinor: rule.amountMinor,
          currency: rule.currency,
          fxRateToBase: rate,
          amountBaseMinor: convertToBase(rule.amountMinor, rate),
          occurredOn: cursor,
          // The rule's name is the row's title and its note stays a note —
          // before migration 0010 the two were squeezed into one field. Slugs
          // travel too, so a seeded rule's rows follow the interface language.
          merchant: rule.name,
          merchantSlug: rule.slug,
          note: rule.note,
          noteSlug: rule.noteSlug,
          source: "recurring",
          recurringRuleId: rule.id,
        });

        inserted += 1;
        cursor = advanceByFrequency(cursor, rule.frequency, rule.interval);
      }

      if (inserted === 0) return 0;

      const finished =
        rule.endOn !== null && compareISO(cursor, rule.endOn) > 0;

      await tx
        .update(recurringRules)
        .set({
          nextRunOn: cursor,
          lastMaterializedOn: asOf,
          active: finished ? false : rule.active,
        })
        .where(eq(recurringRules.id, rule.id));

      return inserted;
    });

    if (result > 0) {
      created += result;
      rulesAdvanced += 1;
    }
  }

  return { created, rulesAdvanced };
}

/** Every household with at least one due rule — used by the cron route. */
export async function listHouseholdsWithDueRules(
  asOf: ISODate,
): Promise<{ householdId: string }[]> {
  const rows = await db
    .selectDistinct({ householdId: recurringRules.householdId })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.active, true),
        lte(recurringRules.nextRunOn, asOf),
      ),
    );

  return rows;
}

/** Next occurrence after a given date, for previewing a rule in the UI. */
export function previewOccurrences(
  startOn: ISODate,
  frequency: Parameters<typeof advanceByFrequency>[1],
  interval: number,
  count: number,
): ISODate[] {
  const result: ISODate[] = [];
  let cursor = startOn;
  for (let i = 0; i < count; i += 1) {
    result.push(cursor);
    cursor = advanceByFrequency(cursor, frequency, interval);
  }
  return result;
}
