import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * One pool per process. Next's dev server re-evaluates modules on HMR, so the
 * pool is stashed on globalThis to avoid leaking a connection pool per reload.
 */
const globalForDb = globalThis as unknown as {
  __ledgerPool?: Pool;
};

function createPool(): Pool {
  const needsSsl =
    env.DATABASE_URL.includes("neon.tech") ||
    env.DATABASE_URL.includes("sslmode=require");

  /*
   * On a serverless host every concurrent invocation is its own process with
   * its own pool, so a generous `max` multiplies rather than shares — a handful
   * of parallel requests can exhaust the database's connection limit outright.
   * One apiece is the right size there; a long-running server is the opposite
   * case and wants a real pool.
   */
  const serverless = process.env.VERCEL === "1";

  return new Pool({
    connectionString: env.DATABASE_URL,
    max: serverless ? 1 : env.NODE_ENV === "production" ? 5 : 3,
    // A pooled endpoint drops idle connections itself; holding them open from a
    // function that is about to be frozen just wastes them.
    ...(serverless ? { idleTimeoutMillis: 10_000 } : {}),
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

const pool: Pool = globalForDb.__ledgerPool ?? createPool();

if (env.NODE_ENV !== "production") {
  globalForDb.__ledgerPool = pool;
}

export type Database = NodePgDatabase<typeof schema>;

export const db: Database = drizzle(pool, { schema });

export { schema, pool };
