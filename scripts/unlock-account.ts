import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { LOCKOUT_WINDOW_MINUTES, MAX_FAILURES } from "@/lib/lockout-config";

config({ path: ".env", quiet: true });

/**
 * Lifts the lockout that repeated failed sign-ins put on an address.
 *
 * The lockout has no way out from inside the app — that is the point of it —
 * and with no password reset by email either, being locked out of your own
 * ledger otherwise means hand-written SQL. Anyone who can run this already has
 * the database credentials, so it grants nothing they did not have.
 *
 * The failures are marked rather than deleted, so the record of what happened
 * survives. `isLockedOut` counts failures since the last success, so a marker
 * success is what actually clears the count.
 *
 *   npm run user:unlock              # show who is locked out
 *   npm run user:unlock -- --apply   # lift it
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL ?? "";
  const pool = new Pool({
    connectionString: url,
    ...(url.includes("neon.tech") ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const db = drizzle(pool, { schema });

  const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000);
  const users = await db.select({ email: schema.users.email }).from(schema.users);

  const locked: string[] = [];

  for (const { email } of users) {
    const [lastSuccess] = await db
      .select({ at: schema.authAttempts.createdAt })
      .from(schema.authAttempts)
      .where(
        and(
          eq(schema.authAttempts.email, email),
          eq(schema.authAttempts.stage, "signin"),
          eq(schema.authAttempts.outcome, "success"),
        ),
      )
      .orderBy(desc(schema.authAttempts.createdAt))
      .limit(1);

    const floor =
      lastSuccess !== undefined && lastSuccess.at > since ? lastSuccess.at : since;

    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.authAttempts)
      .where(
        and(
          eq(schema.authAttempts.email, email),
          eq(schema.authAttempts.stage, "signin"),
          eq(schema.authAttempts.outcome, "failure"),
          gte(schema.authAttempts.createdAt, floor),
        ),
      );

    const failures = Number(row?.n ?? 0);
    const isLocked = failures >= MAX_FAILURES;
    console.log(
      `  ${email.padEnd(28)}${String(failures)}/${String(MAX_FAILURES)} recent failures${isLocked ? "   LOCKED" : ""}`,
    );
    if (isLocked) locked.push(email);
  }

  if (locked.length === 0) {
    console.log("\nNobody is locked out.");
    await pool.end();
    return;
  }

  if (!apply) {
    console.log("\nRe-run with --apply to lift it.");
    await pool.end();
    return;
  }

  for (const email of locked) {
    await db.insert(schema.authAttempts).values({
      email,
      stage: "signin",
      outcome: "success",
      ip: null,
      // Recognisable in the log: this was an administrative unlock, not
      // somebody actually getting in.
      userAgent: "unlock-account script",
    });
    console.log(`\nUnlocked ${email}.`);
  }

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
