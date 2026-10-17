import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import * as schema from "./schema";

config({ path: ".env", quiet: true });

/**
 * Stamps seeded rows with the slug that lets their name follow the interface
 * language. Matches on the strings the seed wrote — both the English ones and
 * the Slovak originals, so it works whichever version of the seed produced the
 * row. Anything it does not recognise is left alone; that is a name someone
 * chose, and it stays exactly as typed.
 */
async function main(): Promise<void> {
  const table = JSON.parse(
    readFileSync(process.argv[2] ?? "", "utf8"),
  ) as Record<string, [string, string, string]>;

  // every known spelling -> slug
  const slugFor = new Map<string, string>();
  for (const [slug, spellings] of Object.entries(table)) {
    for (const spelling of spellings) slugFor.set(spelling, slug);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const report: string[] = [];

  async function stamp(
    label: string,
    rows: readonly { id: string; value: string | null }[],
    apply: (id: string, slug: string) => Promise<unknown>,
  ): Promise<void> {
    let hits = 0;
    for (const row of rows) {
      if (row.value === null) continue;
      const slug = slugFor.get(row.value);
      if (slug === undefined) continue;
      await apply(row.id, slug);
      hits += 1;
    }
    report.push(`${label}: ${hits}/${rows.length}`);
  }

  const households = await db.select().from(schema.households);
  await stamp("households", households.map((r) => ({ id: r.id, value: r.name })),
    (id, slug) => db.update(schema.households).set({ slug }).where(eq(schema.households.id, id)));

  const accounts = await db.select().from(schema.accounts);
  await stamp("accounts", accounts.map((r) => ({ id: r.id, value: r.name })),
    (id, slug) => db.update(schema.accounts).set({ slug }).where(eq(schema.accounts.id, id)));

  const goals = await db.select().from(schema.goals);
  await stamp("goals", goals.map((r) => ({ id: r.id, value: r.name })),
    (id, slug) => db.update(schema.goals).set({ slug }).where(eq(schema.goals.id, id)));

  const rules = await db.select().from(schema.recurringRules);
  await stamp("rule names", rules.map((r) => ({ id: r.id, value: r.name })),
    (id, slug) => db.update(schema.recurringRules).set({ slug }).where(eq(schema.recurringRules.id, id)));
  await stamp("rule notes", rules.map((r) => ({ id: r.id, value: r.note })),
    (id, slug) => db.update(schema.recurringRules).set({ noteSlug: slug }).where(eq(schema.recurringRules.id, id)));

  // Since migration 0010 a seeded title lives in `merchant`; `note` is kept
  // for completeness, though the seed no longer writes notes.
  const txs = await db.select().from(schema.transactions);
  await stamp("transaction merchants", txs.map((r) => ({ id: r.id, value: r.merchant })),
    (id, slug) => db.update(schema.transactions).set({ merchantSlug: slug }).where(eq(schema.transactions.id, id)));
  await stamp("transaction notes", txs.map((r) => ({ id: r.id, value: r.note })),
    (id, slug) => db.update(schema.transactions).set({ noteSlug: slug }).where(eq(schema.transactions.id, id)));

  for (const line of report) console.log(" ", line);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
