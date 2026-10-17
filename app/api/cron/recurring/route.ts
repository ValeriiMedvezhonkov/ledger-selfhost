import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { households } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { todayISO } from "@/lib/date";
import { listHouseholdsWithDueRules, materializeRecurring } from "@/lib/recurring";


function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Daily materialisation of due recurring rules.
 *
 * Safe to call repeatedly: materializeRecurring locks each rule row and
 * advances next_run_on in the same database transaction as the insert.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asOf = todayISO(new Date());
  const due = await listHouseholdsWithDueRules(asOf);

  let created = 0;

  for (const { householdId } of due) {
    const rows = await db
      .select({ baseCurrency: households.baseCurrency })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    const baseCurrency = rows[0]?.baseCurrency;
    if (!baseCurrency) continue;

    const result = await materializeRecurring(householdId, asOf, baseCurrency);
    created += result.created;
  }

  return NextResponse.json({
    ok: true,
    asOf,
    households: due.length,
    created,
  });
}
