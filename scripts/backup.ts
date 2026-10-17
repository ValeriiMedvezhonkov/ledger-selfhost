import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { Pool } from "pg";

config({ path: ".env", quiet: true });

/**
 * Dumps a database to a compressed file.
 *
 * pg_dump is not installed on this machine and, more importantly, must be at
 * least the version of the server it reads — Neon is on 18 while the local
 * container is on 17, so a single pinned client would be wrong for one of them.
 * The server is asked its version and pg_dump is run from the matching official
 * image, which also means nothing has to be installed.
 *
 *   npm run db:backup     # whatever DATABASE_URL points at
 */
const OUT_DIR = "backups";

function majorVersion(full: string): string {
  return full.split(".")[0] ?? "18";
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (url === "") {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  })();

  const pool = new Pool({
    connectionString: url,
    ...(url.includes("neon.tech") ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const { rows } = await pool.query<{ server_version: string }>("show server_version");
  await pool.end();

  const major = majorVersion(rows[0]?.server_version ?? "18");
  const label = host.includes("neon.tech") ? "production" : "local";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `${OUT_DIR}/${label}-${stamp}.sql.gz`;

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Server is Postgres ${major}; dumping with postgres:${major}-alpine`);

  /*
   * The connection string goes in as an environment variable rather than an
   * argument: arguments are visible in the process list to anything else on the
   * machine, and this one contains the database password.
   *
   * --no-owner and --no-acl keep the dump restorable into a database owned by
   * a different role, which is exactly the case when checking it locally.
   */
  const result = spawnSync(
    "sh",
    [
      "-c",
      `docker run --rm -i -e PGURL postgres:${major}-alpine ` +
        `pg_dump --no-owner --no-acl "$PGURL" | gzip > "${file}"`,
    ],
    { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, PGURL: url } },
  );

  if (result.status !== 0) {
    console.error("\nBackup failed. Is Docker running?");
    process.exit(1);
  }

  const bytes = statSync(file).size;
  if (bytes < 1024) {
    console.error(`\n${file} is only ${String(bytes)} bytes — that is not a real dump.`);
    process.exit(1);
  }

  console.log(`\n${file}  (${(bytes / 1024).toFixed(1)} KB)`);
  console.log("\nRestore into a database with:");
  console.log(`  gunzip -c ${file} | psql "<target url>"`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
