// Writes KEY=value pairs into a .env file without ever printing a value.
//
//   node .claude/skills/self-host/set-env.mjs .env \
//     AUTH_ALLOWED_EMAILS=you@example.com,partner@example.com \
//     AUTH_SECRET=@secret CRON_SECRET=@secret POSTGRES_PASSWORD=@hex
//
//   @secret  32 random bytes, base64 — for AUTH_SECRET, CRON_SECRET
//   @hex     24 random bytes, hex — for anything that ends up inside a URL,
//            such as POSTGRES_PASSWORD (base64 can contain / + =)
//
// An existing key is replaced in place; a new one is appended. A generated
// value never replaces one that is already set: Postgres keeps the password
// its volume was created with, so regenerating POSTGRES_PASSWORD would lock
// the app out of its own database. The file is created if missing and left
// readable only by its owner.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const [file, ...pairs] = process.argv.slice(2);
if (!file || pairs.length === 0) {
  console.error("usage: set-env.mjs <file> KEY=value|@secret|@hex ...");
  process.exit(1);
}

let text = existsSync(file) ? readFileSync(file, "utf8") : "";

for (const pair of pairs) {
  const eq = pair.indexOf("=");
  const key = pair.slice(0, eq);
  if (eq < 1 || !/^[A-Z][A-Z0-9_]*$/.test(key)) {
    console.error(`not KEY=value: ${key || pair}`);
    process.exit(1);
  }
  const raw = pair.slice(eq + 1);
  const pattern = new RegExp(`^${key}=(.*)$`, "m");
  const current = pattern.exec(text)?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  if (raw.startsWith("@") && current !== "") {
    console.log(`kept ${key} (already set)`);
    continue;
  }
  const value =
    raw === "@secret"
      ? randomBytes(32).toString("base64")
      : raw === "@hex"
        ? randomBytes(24).toString("hex")
        : raw;
  if (value.includes('"') || value.includes("\n")) {
    console.error(`${key}: value may not contain quotes or newlines`);
    process.exit(1);
  }

  const line = `${key}="${value}"`;
  if (pattern.test(text)) {
    text = text.replace(pattern, () => line);
  } else {
    text += `${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  console.log(`set ${key}${raw.startsWith("@") ? " (generated)" : ""}`);
}

writeFileSync(file, text);
chmodSync(file, 0o600);
