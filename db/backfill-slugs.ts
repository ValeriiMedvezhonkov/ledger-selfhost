import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { SK_CATEGORIES } from "@/lib/merchants";

config({ path: ".env", quiet: true });

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const keyBySkName = new Map(
    Object.entries(SK_CATEGORIES).map(([key, name]) => [name.toLowerCase(), key]),
  );
  keyBySkName.set("nezaradené", "uncategorised");

  const rows = await db.select().from(schema.categories);
  const unmatched: string[] = [];
  let matched = 0;

  for (const row of rows) {
    const key = keyBySkName.get(row.name.toLowerCase());
    if (key === undefined) {
      unmatched.push(`${row.name} (${row.kind})`);
      continue;
    }
    await db
      .update(schema.categories)
      .set({ slug: key })
      .where(eq(schema.categories.id, row.id));
    matched += 1;
  }

  console.log(`slugged ${matched}/${rows.length}`);
  if (unmatched.length > 0) console.log("left as custom:", unmatched);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
