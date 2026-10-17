import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

config({ path: ".env", quiet: true });

/**
 * One command to put a change live, in the order that cannot strand you.
 *
 *   npm run release
 *
 * The order is the point:
 *
 *   1. checks    — a failing test should cost nothing, so it runs before
 *                  anything touches production
 *   2. backup    — taken while the database is still in its old shape
 *   3. migrate   — schema first, because Vercel runs nothing on deploy and new
 *                  code meeting an old schema errors on every request
 *   4. deploy    — only now, when the schema it expects is already there
 *   5. smoke     — confirm the live site actually answers
 *
 * Deploying before migrating is the tempting order and the broken one: there is
 * a window where the new code is live and the column it needs does not exist.
 */
function run(
  label: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): void {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed — stopping. Nothing after this ran.`);
    process.exit(1);
  }
}

/**
 * The production connection string, from the environment or from the file the
 * Vercel CLI wrote. Resolving it here means the incantation is not retyped on
 * every release, which is how the wrong database eventually gets picked.
 */
function productionUrl(): string {
  const fromEnv = process.env.PRODUCTION_DATABASE_URL ?? "";
  if (fromEnv !== "") return fromEnv;

  if (!existsSync(".env.vercel")) {
    console.error("No .env.vercel and no PRODUCTION_DATABASE_URL set.");
    console.error("Run: npx vercel env pull .env.vercel");
    process.exit(1);
  }

  // The direct endpoint, not the pooled one: migrations are DDL, and a
  // transaction-mode pooler is not a reliable place to run it.
  const line = readFileSync(".env.vercel", "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL_UNPOOLED="));

  if (line === undefined) {
    console.error("DATABASE_URL_UNPOOLED is not in .env.vercel.");
    process.exit(1);
  }

  return line.slice("DATABASE_URL_UNPOOLED=".length).trim().replace(/^"|"$/g, "");
}

/**
 * The live address to smoke-test, e.g. https://ledger.example.com — from
 * PRODUCTION_URL in .env or the environment. Optional: without it the release
 * still goes out, it just is not checked from outside afterwards.
 */
const site = (process.env.PRODUCTION_URL ?? "").trim().replace(/\/+$/, "");

function main(): void {
  const url = productionUrl();
  const host = new URL(url).hostname;

  console.log(`Releasing to ${host}`);

  run("checks", "npm", ["run", "check"]);
  run("backup", "npx", ["tsx", "scripts/backup.ts"], { DATABASE_URL: url });
  // Already backed up a moment ago; a second one would only add noise.
  run("migrate", "npx", ["tsx", "db/migrate.ts"], {
    DATABASE_URL: url,
    SKIP_BACKUP: "yes",
  });
  run("deploy", "npx", ["vercel", "deploy", "--prod", "--yes"]);

  console.log(`\n── smoke ${"─".repeat(55)}`);
  if (site === "") {
    console.log("  Skipped: set PRODUCTION_URL in .env to check the live site.");
    console.log("\n✓ Released. Backup is in backups/ if anything needs undoing.");
    return;
  }

  const probe = spawnSync(
    "curl",
    ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${site}/login`],
    { encoding: "utf8" },
  );
  const code = probe.stdout.trim();
  console.log(`  GET ${site}/login -> ${code}`);

  if (code !== "200") {
    console.error("\n✗ The live site did not answer with 200. Check the deployment.");
    process.exit(1);
  }

  console.log("\n✓ Released. Backup is in backups/ if anything needs undoing.");
}

main();
