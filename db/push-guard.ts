/**
 * Wraps `drizzle-kit push`, which diffs the schema and applies the difference
 * directly — dropping columns and tables to make the database match, with no
 * migration file and no record of what it did. Useful while iterating locally,
 * never appropriate against a live ledger.
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { assertLocalDatabase } from "./guard";

config({ path: ".env", quiet: true });
assertLocalDatabase("push a schema diff (this can drop columns)");

const result = spawnSync("npx", ["drizzle-kit", "push"], { stdio: "inherit" });
process.exit(result.status ?? 1);
