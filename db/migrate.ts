import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { spawnSync } from "node:child_process";

config({ path: ".env", quiet: true });

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");
}

/**
 * Takes a backup first when the target is not local.
 *
 * A migration that turns out to be destructive — a rename generates a drop and
 * an add — is not reversible, and the moment you want a backup from is the
 * moment before it ran. Doing it here rather than trusting anyone to remember
 * is the difference between a rule and a habit.
 */
function backupFirst(connectionString: string): void {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    host = "";
  }

  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "db"].includes(host);
  if (local) return;

  console.log(`Backing up ${host} before migrating…`);
  const result = spawnSync("npx", ["tsx", "scripts/backup.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: connectionString },
  });

  if (result.status !== 0) {
    console.error("\n❌ backup failed — not migrating.");
    console.error("Fix the backup, or set SKIP_BACKUP=yes to migrate without one.");
    process.exit(1);
  }
}

async function main(connectionString: string): Promise<void> {
  if (process.env.SKIP_BACKUP !== "yes") backupFirst(connectionString);

  const needsSsl =
    connectionString.includes("neon.tech") ||
    connectionString.includes("sslmode=require");

  const pool = new Pool({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("✅ migrations applied");
  } finally {
    await pool.end();
  }
}

main(url).catch((error: unknown) => {
  console.error("❌ migration failed:", error);
  process.exit(1);
});
