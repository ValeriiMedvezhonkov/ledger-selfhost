# Ledger: notes for Claude

A self-hosted household finance tracker. One deployment = one household; every
member signs in with an allowlisted email and a password stored as a hash in
Postgres. Next.js 16 App Router, React 19, Drizzle ORM, Auth.js v5,
next-intl (en, ru), Tailwind 4. Mobile-first, iOS-styled UI.

- `README.md`: what it is, environment variables, scripts
- `DEPLOY.md`: the three ways to run it (local, Vercel + Neon, Docker server)
- `NOTES.md`: the reasoning behind design decisions; read the relevant
  section before changing something it covers

If someone wants to install or deploy the app, use the `/self-host` skill
(`.claude/skills/self-host/SKILL.md`). It walks through the steps with them.

## Commands

```bash
npm run dev          # http://localhost:3000
npm run check        # typecheck + lint (zero warnings) + vitest. Must pass before committing
npm test             # vitest only
npm run db:generate  # after editing db/schema.ts. Writes a new drizzle/*.sql
npm run db:migrate   # apply migrations
```

## Rules that are easy to break

- **Money is never a float.** Amounts are integer minor units (`bigint`) typed
  as the branded `Minor`. Do arithmetic only through `lib/money.ts`.
- **Every environment variable goes through `lib/env.ts`** (Zod, parsed once
  at boot). Don't read `process.env` elsewhere in app code (the one exception
  is the platform's own `VERCEL` flag in `db/index.ts`). A new variable
  also goes in `.env.example`, the README table, and `compose.yaml` if the
  container needs it.
- **Mutations are Server Actions built on `lib/safe-action.ts`**
  (`authAction` etc.): Zod-validated, re-authenticated inside the action, and
  scoped to the caller's `householdId`. `proxy.ts` is not a security boundary.
- **Every UI string lives in `messages/en.json` and `messages/ru.json`.** Add
  the key to both; `tests/messages.test.ts` and `tests/message-usage.test.ts`
  fail otherwise.
- **Migrations are append-only.** Never edit a `drizzle/*.sql` that may have
  been applied somewhere, and read generated SQL before applying it: a column
  rename comes out as drop + add, which loses data.
- **`components/ui/` is shadcn output.** Regenerate with `npx shadcn add`
  rather than hand-editing.
- **Destructive scripts are local-only.** `db:reset`, `db:seed` and `db:push`
  refuse non-local databases (`db/guard.ts`). Don't work around that.

## Secrets and personal data

- Never commit `.env*` (except `.env.example`), `backups/`, or anything
  containing a real email address, connection string or token. Use
  `you@example.com`-style placeholders in code, tests and docs.
- Don't print secrets back to the user. When generating them, write them
  straight into `.env` (e.g. `openssl rand -base64 32` inside a heredoc).
- `npm run user:password` prompts for a password on a TTY. Ask the user to run
  it themselves in a terminal; never pass a password as an argument.

@AGENTS.md
