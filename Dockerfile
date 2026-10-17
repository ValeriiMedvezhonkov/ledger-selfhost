# syntax=docker/dockerfile:1

# Node 24 to match the version the app is developed and tested against.
# Alpine keeps the final image small; nothing here needs glibc.
FROM node:24-alpine AS base
WORKDIR /app

# --- dependencies ---------------------------------------------------------
# Separate stage so a change to application code does not reinstall the world.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- build ----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build validates the environment, so it needs values — but not the real
# ones. These are placeholders that satisfy the schema and never reach the
# running container, which gets the actual values at runtime.
ENV NODE_ENV=production \
    DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder \
    AUTH_SECRET=build-time-placeholder-value \
    AUTH_ALLOWED_EMAILS=placeholder@example.com \
    CRON_SECRET=build-time-placeholder-value \
    NEXT_TELEMETRY_DISABLED=1 \
    BUILD_STANDALONE=1

RUN npm run build

# Migrations have to run in the container, which has no TypeScript toolchain,
# so the script is bundled to plain JavaScript here.
#
# Only pg is left external. The standalone output keeps it as a real package —
# it loads parts of itself dynamically — while drizzle and dotenv are bundled
# into Next's own server output and are not resolvable as packages at runtime,
# so they have to be bundled into this file too.
#
# CommonJS output, not ESM: dotenv and pg reach for `require` at runtime, and
# esbuild cannot express that inside an ES module — the bundle builds and then
# fails on the first dynamic require.
RUN npx esbuild db/migrate.ts \
      --bundle --platform=node --format=cjs --target=node24 \
      --external:pg --outfile=migrate.cjs

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Not root. A container escape is far less interesting from an account that
# owns nothing.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# The standalone output carries its own minimal node_modules; static assets and
# the public directory are not included in it and have to come along.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations run at start, not during the build, because the build has no
# database. Only the SQL and the bundled runner are needed.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/migrate.cjs ./migrate.cjs

USER nextjs
EXPOSE 3000

# Migrate, then serve. A failed migration stops the container rather than
# letting it start against a schema it does not match.
CMD ["sh", "-c", "node migrate.cjs && node server.js"]
