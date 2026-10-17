import { config } from "dotenv";
import { createInterface } from "node:readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { checkPassword, hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";

config({ path: ".env", quiet: true });

const allowed = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((part) => part.trim().toLowerCase())
  .filter((part) => part.length > 0);

/**
 * Sets an account's password.
 *
 * Prompted rather than passed as an argument: an argument lands in shell
 * history and in the process list, where anyone on the machine can read it. The
 * input is not echoed, and only the hash ever reaches the database.
 *
 *   npm run user:password -- someone@example.com
 */
/**
 * Two input modes, because a terminal and a pipe behave differently enough that
 * one path cannot serve both.
 *
 * A terminal is prompted question by question, with the echo suppressed. A pipe
 * ends after its last line, which closes readline — so a second prompt against
 * it throws ERR_USE_AFTER_CLOSE. Piped input is therefore read in full up
 * front, which also makes the script testable.
 */
const interactive = process.stdin.isTTY;

async function pipedLines(): Promise<string[]> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += String(chunk);
  return text.split("\n");
}

let queued: string[] = [];
let queueIndex = 0;

function ask(question: string, hidden = true): Promise<string> {
  if (!interactive) {
    const line = queued[queueIndex] ?? "";
    queueIndex += 1;
    return Promise.resolve(line);
  }

  if (!hidden) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    process.stdout.write(question);

    // readline echoes as it types; muting its output stream is what keeps the
    // password off the screen and out of a shared terminal's scrollback.
    const stream = rl as unknown as {
      output?: { write: (chunk: string) => void };
    };
    const original = stream.output?.write.bind(stream.output);
    if (stream.output && original) {
      stream.output.write = (chunk: string): void => {
        if (chunk.includes("\n")) original(chunk);
      };
    }

    rl.question("", (answer) => {
      if (stream.output && original) stream.output.write = original;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  if (!interactive) queued = await pipedLines();

  /*
   * The address is asked for rather than taken from the command line.
   *
   * As an argument it sat exactly where a password looks like it belongs, and
   * being typed there is the one thing this script exists to prevent — the
   * argument is recorded in shell history and visible in the process list. With
   * nothing on the command line there is nothing to put in the wrong place.
   */
  const email = (
    process.argv[2] ?? (await ask("Account email: ", false))
  )
    .trim()
    .toLowerCase();

  if (email === "") {
    /*
     * Reached when there is no terminal and nothing piped in — the shape of
     * anything that runs this without an attached tty. The prompts need one,
     * because the whole point is that the password is typed rather than passed.
     */
    console.error(
      interactive
        ? "No address given."
        : [
            "No address given, and there is no terminal to ask for one.",
            "",
            "This needs an interactive terminal: the password is typed at a",
            "prompt so it never reaches shell history or the process list.",
            "Run it from a normal terminal window, in this directory.",
            "",
            "To script it instead, pipe three lines — address, password,",
            "password again:",
            "",
            "  printf '%s\\n' addr pass pass | npm run user:password",
          ].join("\n"),
    );
    process.exit(1);
  }

  /*
   * The argument is the address, and it is an easy one to misread as the
   * password — which would put the password in shell history and the process
   * list, the whole thing this prompt exists to avoid. Anything without an @
   * is refused with that said plainly.
   */
  if (!email.includes("@")) {
    console.error(`"${email}" is not an email address.`);
    console.error("");
    console.error("The argument is the account to set a password for; the");
    console.error("password itself is typed at the prompt, so it never lands");
    console.error("in shell history.");
    console.error("");
    console.error("  npm run user:password -- someone@example.com");
    console.error("");
    console.error("If that was your password, choose a different one — it is");
    console.error("now recorded in your shell history.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const existing = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  /*
   * Create the account if it does not exist yet.
   *
   * A freshly deployed database has no rows at all, so without this there is
   * nothing to set a password on and no way to sign in — the app would be
   * live and permanently locked. The allowlist is the authority on who may
   * exist, so an address on it is allowed to be created here; anything else is
   * refused, and this is the only place accounts are made.
   */
  let user = existing[0];

  if (!user) {
    if (!allowed.includes(email)) {
      console.error(`${email} is not in AUTH_ALLOWED_EMAILS.`);
      console.error("Allowed addresses:");
      for (const address of allowed) console.error(`  ${address}`);
      await pool.end();
      process.exit(1);
    }

    // One household, created by whoever gets there first.
    const households = await db.select().from(schema.households).limit(1);
    const household =
      households[0] ??
      (
        await db
          .insert(schema.households)
          .values({
            name: "Home",
            slug: "householdHome",
            baseCurrency: process.env.APP_BASE_CURRENCY ?? "EUR",
          })
          .returning()
      )[0];

    if (!household) throw new Error("Could not create the household");

    const created = await db
      .insert(schema.users)
      .values({
        email,
        name: email.split("@")[0] ?? email,
        displayName: email.split("@")[0] ?? email,
        emailVerified: new Date(),
        householdId: household.id,
      })
      .returning({ id: schema.users.id, email: schema.users.email });

    user = created[0];
    if (!user) throw new Error("Could not create the account");
    console.log(`Created an account for ${email}.`);
  }

  const password = await ask(`New password for ${user.email}: `);
  const again = await ask("Repeat it: ");

  if (password !== again) {
    console.error("They do not match. Nothing was changed.");
    await pool.end();
    process.exit(1);
  }

  const problem = checkPassword(password);
  if (problem) {
    console.error(
      problem.key === "passwordTooShort"
        ? `Too short — at least ${String(MIN_PASSWORD_LENGTH)} characters. A few plain words beats a short mangled one.`
        : "Too long — 200 characters at most.",
    );
    await pool.end();
    process.exit(1);
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.users.id, user.id));

  /*
   * Existing sessions are left alone deliberately. Setting a password for the
   * first time should not sign somebody out of the browser they are reading
   * these instructions in; a compromise is what "sign out everywhere" is for.
   */
  console.log(`\nPassword set for ${user.email}.`);
  console.log("Existing sessions were left signed in.");

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
