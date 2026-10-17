---
name: self-host
description: Use when someone wants to install, set up, run, deploy or self-host this Ledger app — trying it locally, putting it on Vercel with Neon, or running it on their own server with Docker — or is stuck partway through doing so.
---

# Self-hosting Ledger

## Overview

Get one household's own copy of Ledger running, with the person, one step at
a time. `DEPLOY.md` is the source of truth for every command; this skill is how
to walk someone through it without leaking their secrets or doing things that
are theirs to do.

Assume the person is not a developer. Explain each step in a sentence before
running it, and confirm it worked before moving on.

## Ground rules

- **Secrets never appear in the conversation.** Generate them straight into
  the file with `node .claude/skills/self-host/set-env.mjs` (below). Never
  `cat`, `grep` or echo `.env`. To check a key is set, print the key name
  only: `grep -cE '^AUTH_SECRET=".+"' .env` (prints `1` when set).
- **Passwords are typed by the person, in their own terminal, in this
  folder.** `user:password` prompts on a TTY, which your shell tool doesn't
  have. Give them the exact command, say the password needs 12+ characters,
  wait for them to say it's done, and never put a password on a command
  line. On a server (C) the command is
  `docker compose run --rm tools npm run user:password`.
- **Ask before anything outward-facing:** pushing to GitHub, deploying,
  creating cloud resources, or opening ports. Dashboard clicks (Vercel, Neon,
  DNS) are theirs. Give the exact field names and values, minus the secrets.
- **Never run** `db:reset`, `db:seed` or `db:push` against a non-local
  database.

## 1. Ask, then check

Ask (one question at a time if you can't use a multiple-choice tool):

1. Which option: **A. try it locally**, **B. Vercel + Neon**, or **C. their
   own server**? The table at the top of `DEPLOY.md` helps them choose.
2. The email address of everyone who will sign in. This becomes
   `AUTH_ALLOWED_EMAILS`.
3. Their currency (ISO code, e.g. `EUR`, `CZK`, `USD`).
4. For C: the domain, and whether you are running **on the server** or on
   their laptop. If on the laptop, every server command goes to them to paste
   into their SSH session. Ask them to paste back the output.

Then check prerequisites and stop on anything missing, with a link to install
it:

| Option | Check |
| --- | --- |
| A | `node -v` (24.x), `docker info` |
| B | `node -v` (24.x), `git remote -v` (a GitHub repo *they* own) |
| C | `docker compose version` on the server, `dig +short <domain>` = the server's IP |

## 2. Write the environment

**A and B** keep everything in `.env` in this folder. Every script reads it,
so nothing secret is ever typed on a command line:

```bash
cp -n .env.example .env
node .claude/skills/self-host/set-env.mjs .env \
  AUTH_SECRET=@secret CRON_SECRET=@secret \
  AUTH_ALLOWED_EMAILS=<emails> APP_BASE_CURRENCY=<code>
```

For **B**, also set `DATABASE_URL=PASTE_DIRECT_NEON_STRING_HERE` with the same
command. Once they've created the Neon project (`DEPLOY.md` §B.1), have them
open `.env` in an editor (`open -e .env` on a Mac) and replace the
placeholder with the **direct** string. Then check without printing it:

```bash
grep -cE '^DATABASE_URL=.*neon\.tech' .env    # 1 = pasted
grep -c 'pooler' .env                         # 0 = direct, not pooled
```

**C** writes `.env` on the server, next to `compose.yaml`:

```bash
node .claude/skills/self-host/set-env.mjs .env \
  POSTGRES_PASSWORD=@hex AUTH_SECRET=@secret CRON_SECRET=@secret \
  APP_DOMAIN=<domain> APP_URL=https://<domain> \
  AUTH_ALLOWED_EMAILS=<emails> APP_BASE_CURRENCY=<code>
```

If the server has no Node, they paste the `cat > .env` block from `DEPLOY.md`
§C.3, filled in, **once**. Never regenerate `POSTGRES_PASSWORD` after the
first `docker compose up`.

Generated values are never overwritten when `set-env.mjs` runs again, so it
is safe to repeat.

## 3. Follow DEPLOY.md

Read the section for their option and follow these steps in order. The ones
left out are already done by section 2.

- **A:** steps 1, 2, 4–7
- **B:** steps 1, 3, 4, 5, 6 (for step 4, they copy values out of `.env`
  themselves; you name the fields)
- **C:** steps 2, 4, 5, 6. Step 2 covers private repositories.

After each step, run its check before going on:

| After | Check |
| --- | --- |
| `db:migrate` | prints `migrations applied` |
| `user:password` (theirs) | they saw `Password set for …` |
| `docker compose up` | `docker compose ps` shows `app` running; `docker compose logs app` has `Ready` |
| Vercel deploy | `curl -s -o /dev/null -w '%{http_code}' <url>/login` prints 200 |

When something fails, match it against **Troubleshooting** in `DEPLOY.md`
before guessing.

## 4. Finish

Walk them through **After the first sign-in** in `DEPLOY.md`: home screen,
two-factor, opening balances. Then tell them how to update their option
(the **Updating** part of its section).
