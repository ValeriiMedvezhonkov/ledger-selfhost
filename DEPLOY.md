# Deploying

Three ways to run Ledger, from quickest to most private:

| | [A. Try it locally](#a-try-it-locally) | [B. Vercel + Neon](#b-vercel--neon) | [C. Your own server](#c-your-own-server) |
| --- | --- | --- | --- |
| Good for | Looking around | Using it, without running a server | Using it, with the data on your machine |
| Time | 5 minutes | ~15 minutes | An evening |
| Cost | Free | Free at household size | ~€4/month VPS + a domain |

All three end the same way: you create the accounts from the command line,
then sign in from the browser.

> **Using Claude Code?** Open this folder in it and type `/self-host`. It runs
> these same steps with you.

---

## What every option needs

**Your own copy of the code.** Clone the repository you were given. If you
want Vercel to deploy it (option B), it needs to be a GitHub repository you
own. Fork it, or create a new private repo and push this code to it.

**A list of who may sign in.** Decide the email addresses of everyone in the
household. They go in `AUTH_ALLOWED_EMAILS`, comma-separated. Nobody else can
ever sign in or be given an account, so get the spelling right.

**A few random secrets.** Every option needs `AUTH_SECRET` and `CRON_SECRET`.
Generate each one fresh, and don't reuse them from anywhere else:

```bash
openssl rand -base64 32
```

---

# A. Try it locally

You need **Node.js 24** (https://nodejs.org) and **Docker**
(https://www.docker.com/products/docker-desktop).

**1. Install the dependencies**

```bash
npm ci
```

**2. Start a local Postgres**

```bash
docker run -d --name ledger-pg --restart unless-stopped \
  -e POSTGRES_PASSWORD=ledger -e POSTGRES_USER=ledger -e POSTGRES_DB=ledger \
  -p 55432:5432 postgres:17-alpine

# wait until it accepts connections
until docker exec ledger-pg pg_isready -U ledger >/dev/null 2>&1; do sleep 1; done
```

This matches the `DATABASE_URL` already in `.env.example`.

**3. Create `.env`**

```bash
cp .env.example .env
```

Then edit `.env`:

- `AUTH_SECRET` and `CRON_SECRET`: paste a fresh `openssl rand -base64 32` into each.
- `AUTH_ALLOWED_EMAILS`: your address, plus a second one. The sample data
  needs two people.

**4. Build the database**

```bash
npm run db:migrate
```

**5. Create your account**

```bash
npm run user:password
```

It asks for the email address and then a password (at least 12 characters),
twice. Nothing you type is echoed. The first account creates the household.

**6. Add some data**

Either a year of sample data to look around in:

```bash
npm run db:seed
```

or an empty ledger, the way a real one starts:

```bash
npm run db:categories -- --apply
npm run db:accounts -- --apply
```

**7. Run it**

```bash
npm run dev
```

Open http://localhost:3000 and sign in.

To open it from your phone on the same Wi-Fi, use `http://<your laptop's IP>:3000`.

---

# B. Vercel + Neon

Vercel runs the app and Neon runs the Postgres database. Both have free tiers
that comfortably fit one household. You set the database up from your laptop
first, then deploy, so the app works the moment it goes live.

You need **Node.js 24** on your laptop (https://nodejs.org).

### 1. Create the database

1. Sign up at **https://neon.tech** and create a project. Pick the region
   closest to you.
2. On the project dashboard, click **Connect**. You need two connection
   strings:
   - **Direct.** "Connection pooling" switched **off**. Used from your laptop
     for setup and migrations.
   - **Pooled.** "Connection pooling" switched **on**; the host contains
     `-pooler`. Used by the app on Vercel.

Each string contains the database password. Paste them only where the steps
below say to, and not into chats or commands.

### 2. Prepare `.env` on your laptop

In the project folder:

```bash
npm ci
cp .env.example .env
```

Open `.env` in a text editor and set:

- `DATABASE_URL`: the **direct** Neon string, inside the quotes.
- `AUTH_SECRET` and `CRON_SECRET`: a fresh `openssl rand -base64 32` each.
- `AUTH_ALLOWED_EMAILS`: everyone who will sign in, comma-separated.
- `APP_BASE_CURRENCY`: your currency, e.g. `EUR`.

This `.env` now points at your real database. Use it for the setup commands
below, and don't run `npm run dev` with it.

### 3. Set up the database

```bash
SKIP_BACKUP=yes npm run db:migrate   # creates the tables (nothing to back up yet)
npm run user:password                # once for each person
npm run db:categories -- --apply     # the standard categories
npm run db:accounts -- --apply       # Current, Savings, Cash, all at zero
```

`user:password` asks for the email address and then a password (at least 12
characters) twice. The first person creates the household; everyone after
that joins it.

### 4. Deploy the app

1. Sign up at **https://vercel.com** with your GitHub account.
2. **Add New… → Project** and import your copy of the repository.
3. Before clicking Deploy, open **Environment Variables** and add these. Copy
   the values from your `.env`, without the quotes:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the **pooled** Neon string (not the one in `.env`) |
   | `AUTH_SECRET` | same as in `.env` |
   | `CRON_SECRET` | same as in `.env` |
   | `AUTH_ALLOWED_EMAILS` | same as in `.env` |
   | `APP_BASE_CURRENCY` | same as in `.env` |

4. Click **Deploy**. When it finishes, note the production address, e.g.
   `https://ledger-yourname.vercel.app`.

### 5. Tell the app its address

In Vercel → **Settings → Environment Variables**, add `AUTH_URL` with your
production address, e.g. `https://ledger-yourname.vercel.app`, with no trailing
slash. Then **Deployments → ⋯ → Redeploy**.

Sign-in works without it, but Face ID app lock (passkeys) is tied to this
exact address. If you add a custom domain later, update `AUTH_URL` to match.

### 6. Done

Open the address, sign in, then go to [After the first sign-in](#after-the-first-sign-in).

`vercel.json` already schedules the daily job that books recurring
transactions. Vercel sends `CRON_SECRET` with it automatically.

### Updating

Pull new code into your copy, then:

1. If anything under `drizzle/` changed, **migrate first**, using the `.env`
   from step 2: `SKIP_BACKUP=yes npm run db:migrate`. Drop the `SKIP_BACKUP`
   part if Docker is running, and it backs up first.
2. Push to GitHub. Vercel deploys automatically.

Migrating first matters because new code meeting an old schema errors on every
request until the migration runs.

`npm run release` does the whole sequence for you: checks, backup, migrate,
deploy, smoke test. It needs the Vercel CLI (`npm i -g vercel`, then
`vercel link`) and Docker for the backup. Put `PRODUCTION_URL=https://…` in
`.env` to have it check the live site at the end.

### Worth knowing

- **Cold starts.** A request after a quiet period takes a second or two. With
  one household, that's most first loads.
- **Where the data is.** Transactions, balances and password hashes sit on
  Neon's servers. Decide that deliberately for a household ledger. Option C
  exists for exactly this reason.
- **Backups.** Neon keeps a short point-in-time history on the free tier.
  Take an occasional dump of your own as well. See [Backups](#backups).

---

# C. Your own server

The whole thing runs as three containers: the app, Postgres, and Caddy, which
gets and renews the HTTPS certificate by itself. No email provider, no OAuth
app, no third-party account.

### 1. What you need

- **A Linux server with a public IP.** A €4/month VPS (Hetzner, DigitalOcean,
  …) is plenty. A box at home works too, if you can forward ports 80 and 443.
- **Docker** on it: https://docs.docker.com/engine/install/
- **A domain name** with a DNS `A` record pointing at the server's IP. A
  subdomain of one you already own, like `ledger.yourdomain.com`, is fine.

### 2. Get the code onto the server

```bash
git clone <your copy of the repository> ledger
cd ledger
```

If the repository is private, the server can't clone it without signing in to
GitHub. Either install the GitHub CLI there and run `gh auth login`, then
`gh repo clone <you>/<repo> ledger`, or copy the folder up from your laptop:

```bash
rsync -a --exclude node_modules --exclude .next --exclude .env ./ you@server:ledger/
```

### 3. Create `.env` next to `compose.yaml`

Replace the three lines marked `← change` and paste the rest as it is. The
`$(…)` parts generate the secrets on the spot.

```bash
cat > .env <<EOF
APP_DOMAIN="ledger.yourdomain.com"                       # ← change
APP_URL="https://ledger.yourdomain.com"                  # ← change
AUTH_ALLOWED_EMAILS="you@example.com,partner@example.com" # ← change
APP_BASE_CURRENCY="EUR"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
AUTH_SECRET="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -base64 32)"
EOF
chmod 600 .env
```

Run this **once**. To change a value later, edit the file (`nano .env`)
rather than running the block again. A second run makes a new
`POSTGRES_PASSWORD`, but the database keeps the one it was created with, and
the app can no longer connect.

`APP_URL` must be the address the browser uses. It decides whether cookies
get the `__Secure-` prefix, and what Face ID app lock is tied to.

### 4. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. The app runs its database migrations on
every start, and refuses to start if one fails rather than serve against the
wrong schema. Check on it with:

```bash
docker compose ps
docker compose logs -f app     # Ctrl-C to stop watching
```

### 5. Create the accounts

The admin scripts run in a short-lived `tools` container that can reach the
database:

```bash
docker compose run --rm tools npm run user:password         # once for each person
docker compose run --rm tools npm run db:categories -- --apply
docker compose run --rm tools npm run db:accounts -- --apply
```

The first account creates the household and the second joins it. The address
must be in `AUTH_ALLOWED_EMAILS`; anything else is refused.

### 6. Done

Open `https://ledger.yourdomain.com`. The very first load can take a few
seconds while Caddy fetches the certificate. Then go to
[After the first sign-in](#after-the-first-sign-in).

Recurring transactions are booked whenever someone opens the home or stats
screen, so no cron job is needed.

### Updating

```bash
git pull
docker compose up -d --build
docker compose build tools      # so the admin scripts are current too
```

Migrations run automatically on start.

### Backups

```bash
docker compose exec -T db pg_dump -U ledger --no-owner ledger | gzip > ledger-$(date +%F).sql.gz
```

Copy the file somewhere that isn't the server. To restore onto a new server,
load the dump *before* the app starts for the first time, since the app would
otherwise create empty tables that collide with it:

```bash
docker compose up -d db
gunzip -c ledger-2026-10-17.sql.gz | docker compose exec -T db psql -U ledger -d ledger
docker compose up -d --build
```

---

# After the first sign-in

- **Add it to your home screen.** In Safari, Share → *Add to Home Screen*. It
  opens full-screen like an app.
- **Turn on two-factor** in More → Password & sign-in, on every account, and
  keep the backup codes somewhere that isn't the app.
- **Set real opening balances** under Accounts. The starter accounts open at
  zero.
- **Apple Pay logging (optional).** More → Apple Pay generates a token and
  explains the iOS Shortcuts automation that records each tap.
- **Check the sign-in log** in More → Password & sign-in now and then. It
  records every attempt, including ones against addresses that aren't
  allowlisted.
- **Currency and household name** are in More → Household. `APP_BASE_CURRENCY`
  only sets the starting value.

---

# Reference

## Passwords and lockouts

To change a password, run `user:password` again for the same address. Existing
sessions stay signed in.

Five failed sign-ins in fifteen minutes lock that address, and there is no
reset email by design. Unlock from the command line, pointed at the database
in question:

```bash
npm run user:unlock               # who is locked out
npm run user:unlock -- --apply    # lift it

# on your own server:
docker compose run --rm tools npm run user:unlock -- --apply
```

The unlock is recorded rather than deleting the failures, so the attempts stay
visible in More → Password & sign-in.

## Backups

```bash
npm run db:backup
```

It backs up whatever `DATABASE_URL` in `.env` points at. That's the local
database, or production with the `.env` from option B. On your own server, use
the `pg_dump` command in option C instead.

Writes `backups/<label>-<timestamp>.sql.gz`. That directory is gitignored and
must stay that way: a dump holds every transaction and every password hash.

`pg_dump` runs from the official Postgres image matching the server's major
version, so Docker must be running but nothing else needs installing.

`npm run db:migrate` against a non-local database takes a backup first, and
refuses to continue if that fails. `SKIP_BACKUP=yes` opts out. That's fine for
the very first migration of an empty database.

Restore into a *scratch* database first and look at it before touching a live
one. A backup nobody has restored is a guess.

## Changing the schema

```bash
npm run db:generate   # after changing db/schema.ts. Writes a .sql file
npm run db:migrate    # applies anything not yet applied
```

Applied migrations are recorded in the database, so re-running is a no-op.
Never edit a migration that has already been applied somewhere. Write a new
one.

Read the generated SQL before applying it. Renaming a column generates a drop
and an add, which loses its contents.

`db:reset`, `db:seed` and `db:push` destroy data, and refuse to run against
anything but a local database.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build or start fails with `Invalid environment configuration` | A required variable is missing or too short. The message lists which. |
| Correct password, but you land back on the login page | `AUTH_URL`/`APP_URL` doesn't match the address in the browser (http vs https, or a different domain). |
| `… is not in AUTH_ALLOWED_EMAILS` | Add the address to the allowlist. On Vercel, also redeploy. |
| `backup failed — not migrating` | Docker isn't running. Start it, or prefix the command with `SKIP_BACKUP=yes`. |
| Own server: app restarts in a loop, logs say `password authentication failed` | `POSTGRES_PASSWORD` in `.env` changed after the database was first created. Put the original back. |
| Caddy can't get a certificate | The DNS record doesn't point at the server yet, or ports 80/443 are blocked by a firewall. |
| Dev server opened from another device: page loads but sign-in does nothing | Development only. Private IPs are allowed already; add any other host name you use (e.g. `mylaptop.local`) to `DEV_ORIGINS` in `.env`. |
