import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import en from "../messages/en.json";
import ru from "../messages/ru.json";

config({ path: ".env", quiet: true });

/**
 * Gives a household its starter accounts.
 *
 * The companion to db:categories, and needed for the same reason: a deployed
 * ledger has neither, and a transaction needs an account to belong to.
 *
 * Balances start at zero. Guessing them would be worse than leaving them —
 * every figure in the app derives from the opening balance, so a wrong one
 * quietly makes every total wrong. Set the real ones in the app once you can
 * see them.
 *
 *   npm run db:accounts            # show what would be created
 *   npm run db:accounts -- --apply # create it
 */
interface AccountSpec {
  readonly slug: string;
  readonly type: "checking" | "savings" | "cash" | "credit" | "investment";
  readonly sortOrder: number;
}

const STARTER: readonly AccountSpec[] = [
  { slug: "accountCurrent", type: "checking", sortOrder: 0 },
  { slug: "accountSavings", type: "savings", sortOrder: 1 },
  { slug: "accountCash", type: "cash", sortOrder: 2 },
];

function nameFor(slug: string, locale: "en" | "ru"): string {
  const table: Record<string, string> = locale === "ru" ? ru.seeded : en.seeded;
  return table[slug] ?? slug;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL ?? "";
  const pool = new Pool({
    connectionString: url,
    ...(url.includes("neon.tech") ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const db = drizzle(pool, { schema });

  const [household] = await db.select().from(schema.households).limit(1);
  if (!household) {
    console.error("No household yet. Create an account first:");
    console.error("  npm run user:password");
    await pool.end();
    process.exit(1);
  }

  const existing = await db
    .select({ slug: schema.accounts.slug, name: schema.accounts.name })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, household.id));

  const present = new Set(existing.map((row) => row.slug));
  const missing = STARTER.filter((spec) => !present.has(spec.slug));

  console.log(`Household: ${household.name}   currency: ${household.baseCurrency}`);
  console.log(`Already there: ${String(existing.length)}`);
  console.log(`To create:     ${String(missing.length)}\n`);

  if (existing.length > 0) {
    for (const row of existing) console.log(`  (existing) ${row.name}`);
    console.log("");
  }

  if (missing.length > 0) {
    console.log("  RUSSIAN               ENGLISH             TYPE       OPENING");
    console.log("  " + "-".repeat(62));
    for (const spec of missing) {
      console.log(
        "  " +
          nameFor(spec.slug, "ru").padEnd(22) +
          nameFor(spec.slug, "en").padEnd(20) +
          spec.type.padEnd(11) +
          `0.00 ${household.baseCurrency}`,
      );
    }
    console.log("");
  }

  if (!apply) {
    console.log("Nothing written. Re-run with --apply to create them.");
    await pool.end();
    return;
  }

  if (missing.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  await db.insert(schema.accounts).values(
    missing.map((spec) => ({
      householdId: household.id,
      // The slug drives what is shown; this is the fallback text.
      name: nameFor(spec.slug, "en"),
      slug: spec.slug,
      type: spec.type,
      currency: household.baseCurrency,
      openingBalanceMinor: 0 as never,
      sortOrder: spec.sortOrder,
    })),
  );

  console.log(`Created ${String(missing.length)} accounts, all opening at zero.`);
  console.log("Set the real balances in the app under Accounts.");
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
