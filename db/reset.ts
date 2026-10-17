import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { assertLocalDatabase } from "./guard";

config({ path: ".env", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env");

assertLocalDatabase("drop the entire schema");

async function main(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    console.log("✅ schema dropped — run db:migrate && db:seed next");
  } finally {
    await pool.end();
  }
}

main(url).catch((error: unknown) => {
  console.error("❌ reset failed:", error);
  process.exit(1);
});
