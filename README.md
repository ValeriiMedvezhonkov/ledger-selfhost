# Ledger

A private household finance tracker you host yourself. Mobile-first: add it
to your iPhone's home screen and it behaves like a native app. It is closed to
everyone except the email addresses you put on an allowlist.

Accounts · categories · transactions (including transfers, splits and
multi-currency) · budgets · recurring payments · savings goals · net worth ·
CSV import/export · a statistics dashboard · Apple Pay tap logging · two-factor
sign-in and a Face ID app lock. The interface is in English and Russian.

Each deployment holds **one household**. It was built for a couple, and every
member signs in with their own email and password. To give a friend their own
ledger, they deploy their own copy. Nobody shares a database.

---

## Deploy your own

Pick one. The app is the same either way.

| | **Vercel + Neon** | **Your own server** | **Just try it locally** |
| --- | --- | --- | --- |
| Effort | ~15 minutes, no server admin | An evening | 5 minutes |
| Cost | Free at household size | ~€4/month VPS | Free |
| You need | GitHub, Vercel and Neon accounts | A VPS with Docker and a domain | Node.js 24 and Docker |
| Where the data lives | Neon's cloud | Your machine | Your laptop |

**→ [DEPLOY.md](DEPLOY.md) has step-by-step instructions for all three.**

### Let Claude Code do it with you

If you use [Claude Code](https://claude.com/claude-code), open this folder in it
and type:

```
/self-host
```

It asks which of the three options you want, checks your machine, writes your
`.env` with freshly generated secrets, runs the database steps and tells you
exactly what to click on Vercel or type on your server. It stops and hands over
to you for the steps that are yours alone: typing your password, and adding
environment variables to a dashboard.

`CLAUDE.md` gives Claude the conventions of this codebase, so you can also just
ask it for changes ("add a Polish translation", "add my bank's CSV format").

---

## Before you start: things that are specific to the original household

This app was built for a household in Slovakia, and a few defaults show it.
None of them get in your way, but it helps to know:

- **Merchant recognition** (`lib/merchants.ts`) knows ~110 Slovak shops and
  services. Elsewhere, transactions just aren't auto-categorised by merchant
  name. Add your own local shops to that list if you want it.
- **CSV import presets** (`lib/csv.ts`) cover Slovak banks and Revolut. Any
  other bank's CSV still imports: you map the columns by hand once.
- **The base currency** starts as `APP_BASE_CURRENCY` (default `EUR`) and can
  be changed later in More → Household. Every total is reported in it.
- **Sample data** (`npm run db:seed`, local only) is a year in Bratislava.

## Environment

Every variable is checked once, at startup, by `lib/env.ts`. A misconfigured
deployment fails immediately with a list of what is wrong, rather than at the
first request that needs the value.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Encrypts sessions. `openssl rand -base64 32` |
| `AUTH_ALLOWED_EMAILS` | yes | Comma-separated. **Nobody else can sign in, ever** |
| `CRON_SECRET` | yes | Protects `/api/cron/recurring`. `openssl rand -base64 32` |
| `AUTH_URL` | recommended | The address people open, e.g. `https://ledger.example.com` |
| `APP_BASE_CURRENCY` | no | The household's starting currency (ISO-4217), default `EUR` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | no | Adds "Sign in with Google". Both or neither |
| `WALLET_WEBHOOK_SECRET` | no | Legacy. Generate the Apple Pay token in the app instead |
| `DEV_ORIGINS` | no | Development only: extra hosts allowed to reach the dev server |

The Docker setup uses a few more (`POSTGRES_PASSWORD`, `APP_DOMAIN`,
`APP_URL`). They are explained in [DEPLOY.md](DEPLOY.md).

### Signing in

Accounts are an email address plus a password, stored as a scrypt hash in your
database. No email provider or OAuth app is needed. Accounts are created from
the command line with `npm run user:password`, and only for addresses on
`AUTH_ALLOWED_EMAILS`. Anyone else is refused before a single row is written.

Google sign-in is optional. To add it, create an OAuth client at
https://console.cloud.google.com/apis/credentials with the redirect URI
`https://YOUR-DOMAIN/api/auth/callback/google`, and set both Google variables.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run check` | typecheck + lint + tests. Run this before committing |
| `npm run db:migrate` | Apply database migrations |
| `npm run user:password` | Create an account, or change its password |
| `npm run user:unlock` | Lift a lockout after too many failed sign-ins |
| `npm run db:categories` | Give a new household the standard categories (`-- --apply`) |
| `npm run db:accounts` | Give a new household starter accounts (`-- --apply`) |
| `npm run db:backup` | Dump the database to `backups/` (needs Docker) |
| `npm run db:seed` | Replace finance data with a year of samples (local only) |
| `npm run db:reset` | Drop everything (local only) |
| `npm run db:generate` | Create a migration after changing `db/schema.ts` |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run release` | Check, back up, migrate, deploy to Vercel, smoke-test |

## How it works

- **Next.js 16, server-first.** Pages, layouts and every query are React
  Server Components. `"use client"` appears only on interactive leaves.
- **Mutations are Server Actions** wrapped in `next-safe-action`, validated with
  Zod, re-authenticated inside the action, and scoped to the caller's household.
  The proxy (`proxy.ts`) only does optimistic redirects; it is not the security
  boundary.
- **Money is never a float.** Amounts are integer minor units in Postgres
  `bigint`, mapped to a branded `Minor` type so the compiler rejects arithmetic
  outside `lib/money.ts`.
- **Multi-currency** stores the FX rate captured at entry time alongside the
  derived base-currency amount. Historical rows are never re-converted, so past
  totals do not change when rates move.
- **Transfers are two linked rows** and are excluded from income and expense
  statistics. Moving your own money is not spending.

## Layout

```
app/
  (app)/          the signed-in app: home, transactions, accounts, budgets,
                  recurring, goals, stats, import, more, settings
  login/ verify/  sign-in and two-factor
  api/            auth, cron, exports, session, Apple Pay webhook
components/
  ios/            the iOS-style building blocks (sheets, lists, tab bar…)
  ui/             shadcn output. Regenerate with `npx shadcn add`
db/               schema, migration runner, seed
drizzle/          SQL migrations. Never edit one that has been applied
lib/              env, auth, money, dates, queries, stats, CSV, merchants
messages/         en.json, ru.json: every string in the interface
scripts/          account, backup and release tooling
```

See `NOTES.md` for the decisions behind these.
