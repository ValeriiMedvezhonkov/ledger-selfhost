/**
 * Refuses destructive commands against anything that is not a local database.
 *
 * The old guard checked NODE_ENV, which does not protect the thing that
 * actually needs protecting. Every command in this project is run from a
 * laptop with an explicit connection string:
 *
 *   DATABASE_URL="<production>" npm run db:reset
 *
 * NODE_ENV is unset there, so the guard passed and the production schema would
 * have been dropped. What matters is where the connection points, not what the
 * environment claims.
 *
 * The override is deliberately awkward. Restoring a dropped ledger means
 * finding a backup, and no wrapper can undo it.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "db"]);

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return "";
  }
}

export function assertLocalDatabase(action: string): void {
  const url = process.env.DATABASE_URL ?? "";
  const host = hostOf(url);

  if (LOCAL_HOSTS.has(host)) return;

  if (process.env.I_UNDERSTAND_THIS_DESTROYS_DATA === "yes") {
    console.warn(
      `⚠  ${action} against ${host} — proceeding because ` +
        "I_UNDERSTAND_THIS_DESTROYS_DATA=yes",
    );
    return;
  }

  console.error(
    [
      "",
      `Refusing to ${action}.`,
      "",
      `  target: ${host === "" ? "(unparseable DATABASE_URL)" : host}`,
      "",
      "This command destroys data, and that host is not a local database.",
      "Migrations are the safe way to change a live schema:",
      "",
      "  npm run db:generate   # write a migration from the schema change",
      "  npm run db:migrate    # apply it, keeping existing rows",
      "",
      "If you genuinely mean to wipe it, take a backup first:",
      "",
      '  pg_dump "$DATABASE_URL" | gzip > backup-$(date +%F).sql.gz',
      "",
      "then re-run with I_UNDERSTAND_THIS_DESTROYS_DATA=yes",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
