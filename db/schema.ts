import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import {
  type Minor,
  type ScaledRate,
  minorFromDb,
  rateFromDb,
} from "@/lib/money";

/**
 * Monetary columns are Postgres `bigint` holding integer minor units, mapped to
 * the branded `Minor` type so the compiler stops anyone doing float maths on a
 * balance. Rates are integers scaled by RATE_SCALE for the same reason.
 */
const minorUnits = customType<{ data: Minor; driverData: string }>({
  dataType() {
    return "bigint";
  },
  fromDriver(value) {
    return minorFromDb(value);
  },
  toDriver(value) {
    return String(value);
  },
});

const scaledRate = customType<{ data: ScaledRate; driverData: string }>({
  dataType() {
    return "bigint";
  },
  fromDriver(value) {
    return rateFromDb(value);
  },
  toDriver(value) {
    return String(value);
  },
});

const currency = (name: string) => text(name).notNull();

// --- enums ----------------------------------------------------------------

export const accountTypeEnum = pgEnum("account_type", [
  "checking",
  "savings",
  "cash",
  "credit",
  "investment",
]);

export const categoryKindEnum = pgEnum("category_kind", ["income", "expense"]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
]);

/**
 * Where a row came from. Drives the small provenance line on the detail screen
 * ("Apple Pay · 14:32") and lets a recurring or imported row be told apart from
 * one somebody typed — without inferring it from the shape of the note, which
 * is what the app had to do before this existed.
 */
export const transactionSourceEnum = pgEnum("transaction_source", [
  "manual",
  "apple_pay",
  "import",
  "recurring",
]);

export const frequencyEnum = pgEnum("recurrence_frequency", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

// --- household + auth -----------------------------------------------------

export const households = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * Set only on rows the seed creates, so the name can follow the interface
   * language. Null for anything the household makes or renames itself.
   */
  slug: text("slug"),
  baseCurrency: currency("base_currency"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "set null",
  }),
  displayName: text("display_name"),
  color: text("color").notNull().default("#6366f1"),
  /**
   * scrypt hash, with its parameters embedded — see lib/password.ts. Null for
   * an account that has never had one set, which cannot sign in with a
   * password rather than being able to sign in without one.
   */
  passwordHash: text("password_hash"),
  /**
   * TOTP shared secret, encrypted with a key derived from AUTH_SECRET. Stored
   * rather than hashed because the server has to recompute codes from it; see
   * lib/secret-box.ts for why that is still worth encrypting.
   */
  totpSecret: text("totp_secret"),
  /** Set when the first correct code proves the authenticator is working. */
  totpConfirmedAt: timestamp("totp_confirmed_at", { withTimezone: true }),
  /**
   * The last 30-second step accepted for this user. Rejecting a step at or
   * below it is what makes each code single-use, rather than reusable for the
   * remainder of its window.
   */
  totpLastStep: integer("totp_last_step"),
  /**
   * The member's avatar — one emoji, shown on the splash, the member filter
   * and every "whose" chip. Null renders the initial on the member's colour.
   * It used to be a map hard-coded by email in the splash; editable data
   * belongs in a row, not in a component.
   */
  avatarEmoji: text("avatar_emoji"),
  /**
   * The Face ID app lock is on. Per user rather than per device: the passkeys
   * live in webauthn_credential, and every session of a user with this set
   * starts locked until one of them is presented — see session.appUnlockedAt.
   */
  appLockEnabled: boolean("app_lock_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Single-use codes for getting back in when the authenticator is lost.
 *
 * Hashed, because unlike the TOTP secret these never need to be read back —
 * only compared against.
 */
export const backupCodes = pgTable(
  "backup_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("backup_code_user_idx").on(table.userId)],
);

/**
 * The categories a household has pinned to the quick row of the add form.
 *
 * Curated rather than inferred. The form falls back to the merchants seen most
 * often when this is empty, which is a reasonable guess and no more than that —
 * once somebody says what they want one tap away, guessing is worse than
 * obeying.
 */
export const quickPicks = pgTable(
  "quick_pick",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("quick_pick_household_idx").on(table.householdId, table.sortOrder),
    // A category pinned twice would render two identical chips.
    uniqueIndex("quick_pick_unique").on(table.householdId, table.categoryId),
  ],
);

/**
 * Long-lived credentials that mint a fresh session when the short one lapses.
 *
 * This is what makes renewal silent, and it lets sessions be short — the
 * credential sent on every request lives days, while the one that renews it is
 * spent once and replaced.
 *
 * Every use rotates the token and the old one is marked spent. A spent token
 * turning up again means it was copied, because the honest browser has already
 * moved on — so the whole `family` is revoked and both parties have to sign in.
 * That is the only way to detect theft of a credential that is, by design,
 * replayable.
 */
export const refreshTokens = pgTable(
  "refresh_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Shared by every token descended from one sign-in. */
    family: uuid("family").notNull(),
    tokenHash: text("token_hash").notNull(),
    /**
     * Whether the sign-in this descends from had satisfied the second factor.
     * Carried forward so renewal does not quietly downgrade a verified session,
     * nor re-prompt somebody who already proved it.
     */
    totpVerified: boolean("totp_verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("refresh_token_user_idx").on(table.userId),
    index("refresh_token_family_idx").on(table.family),
  ],
);

/**
 * Every attempt to get in, successful or not, with the address it came from.
 *
 * Two jobs: showing you unfamiliar IPs, and giving the rate limiter something
 * to count. Keyed by the email that was *tried*, not by user id, so attempts
 * against addresses that do not exist are recorded too — those are the
 * interesting ones.
 */
export const authAttempts = pgTable(
  "auth_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** "signin" | "totp" | "backup" — which gate was being attempted. */
    stage: text("stage").notNull(),
    outcome: text("outcome").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("auth_attempt_created_idx").on(table.createdAt),
    index("auth_attempt_email_idx").on(table.email, table.createdAt),
    index("auth_attempt_ip_idx").on(table.ip, table.createdAt),
  ],
);

export const authAccounts = pgTable(
  "auth_account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("auth_account_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "session",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
    /**
     * When the second factor was satisfied *for this session*.
     *
     * Per-session rather than per-user: signing in somewhere new has to prove
     * the second factor again, and revoking one session cannot leave another
     * quietly trusted. Database sessions are what make this possible — with a
     * JWT there would be nothing server-side to mark.
     */
    totpVerifiedAt: timestamp("totp_verified_at", { withTimezone: true }),
    /**
     * When this session last passed the app lock. Null means locked.
     *
     * Per session for the same reason as `totpVerifiedAt`: unlocking the phone
     * must not unlock the laptop. The client clears it on a cold start or after
     * inactivity (`lockApp`), and only a verified passkey assertion sets it.
     */
    appUnlockedAt: timestamp("app_unlocked_at", { withTimezone: true }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

/**
 * Passkeys that unlock the app — Face ID / Touch ID on the device that
 * registered them. Only the public half is stored; there is nothing here an
 * attacker could replay.
 */
export const webauthnCredentials = pgTable(
  "webauthn_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The authenticator's credential id, base64url, as the browser sends it. */
    credentialId: text("credential_id").notNull().unique(),
    /** COSE public key, base64url. */
    publicKey: text("public_key").notNull(),
    /**
     * Signature counter. bigint because the spec allows the full uint32 range,
     * which overflows a Postgres integer; Apple's synced passkeys always report
     * zero, so a regression check only ever bites on hardware keys.
     */
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    /** "iPhone", "Mac" — guessed from the user agent at registration. */
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("webauthn_credential_user_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// --- finance --------------------------------------------------------------

export const accounts = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** See households.slug — seeded rows only. */
    slug: text("slug"),
    type: accountTypeEnum("type").notNull().default("checking"),
    currency: currency("currency"),
    openingBalanceMinor: minorUnits("opening_balance_minor").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Where a new entry lands unless somebody picks otherwise — the add sheet's
     * preselection and the Apple Pay webhook's target. At most one per
     * household, enforced by the partial unique index below rather than by
     * every writer remembering to clear the old one first.
     */
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_household_idx").on(table.householdId),
    uniqueIndex("account_one_default_per_household")
      .on(table.householdId)
      .where(sql`${table.isDefault}`),
  ],
);

export const categories = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Stable key for a category the app ships, so its display name can follow
     * the interface language. Null for anything the household creates itself:
     * there is no translation for a name someone typed, and `name` is used
     * as-is. Renaming a shipped category clears it, which is the point — an
     * explicit rename should stop being overridden by the catalogue.
     */
    slug: text("slug"),
    kind: categoryKindEnum("kind").notNull().default("expense"),
    icon: text("icon").notNull().default("Circle"),
    color: text("color").notNull().default("#6366f1"),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    /** The fallback category transactions are moved to on delete. */
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("category_household_idx").on(table.householdId),
    uniqueIndex("category_one_system_per_household")
      .on(table.householdId)
      .where(sql`${table.isSystem}`),
  ],
);

export const transactions = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    /** Who typed it in. May differ from paidByUserId when one partner
     *  records something on the other's behalf. */
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Who the money is attributed to — whose expense or income it is. */
    paidByUserId: text("paid_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Who last edited it. Null until someone does. */
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: transactionTypeEnum("type").notNull(),
    /** Signed: expenses and outgoing transfer legs are negative. */
    amountMinor: minorUnits("amount_minor").notNull(),
    currency: currency("currency"),
    /** Rate captured at entry time. Historical rows are never re-converted. */
    fxRateToBase: scaledRate("fx_rate_to_base").notNull(),
    amountBaseMinor: minorUnits("amount_base_minor").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    /**
     * The clock time, when it is actually known: an Apple Pay tap, or a manual
     * entry made on the day it happened. Null for back-dated entries, imports
     * and recurring rows — inventing a time for those would print a precise
     * "00:00" nobody ever saw. `occurredOn` stays the date of record.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    /**
     * The row's title — who was paid ("Lidl"), or what it was ("Obed v práci").
     * Split out of `note` in migration 0010: the old single field was "merchant
     * *or* note", which left nowhere to put a real note about a Lidl run.
     */
    merchant: text("merchant"),
    /** See noteSlug — seeded rows only, so the title follows the language. */
    merchantSlug: text("merchant_slug"),
    /** Free text about the entry. Never the title any more. */
    note: text("note"),
    /** Set only on seeded sample rows, so the note reads in the
     *  interface language. Cleared the moment anyone edits it. */
    noteSlug: text("note_slug"),
    source: transactionSourceEnum("source").notNull().default("manual"),
    /**
     * The rule that produced this row, or that was made from it ("Сделать
     * регулярной"). Set null rather than cascading: deleting a rule must not
     * erase the money it already moved.
     */
    recurringRuleId: uuid("recurring_rule_id").references(
      (): AnyPgColumn => recurringRules.id,
      { onDelete: "set null" },
    ),
    /**
     * Shared by the two halves of a «пополам» entry — one row per member, so
     * every per-person total keeps working without knowing splits exist.
     */
    splitGroupId: uuid("split_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Merchant history ("6 раз за полгода, в среднем …") matches
    // case-insensitively, so the index is on the lowered value it compares.
    index("transaction_household_merchant_idx").on(
      table.householdId,
      sql`lower(${table.merchant})`,
    ),
    index("transaction_split_group_idx").on(table.splitGroupId),
    index("transaction_household_date_idx").on(
      table.householdId,
      table.occurredOn,
    ),
    index("transaction_household_category_idx").on(
      table.householdId,
      table.categoryId,
    ),
    index("transaction_account_idx").on(table.accountId),
    index("transaction_paid_by_idx").on(table.paidByUserId),
  ],
);

/** A transfer is two transaction rows; this pairs them. */
export const transferLinks = pgTable(
  "transfer_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromTransactionId: uuid("from_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    toTransactionId: uuid("to_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("transfer_link_from_idx").on(table.fromTransactionId),
    uniqueIndex("transfer_link_to_idx").on(table.toTransactionId),
  ],
);

export const budgets = pgTable(
  "budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** First day of the month this budget applies to. */
    periodStart: date("period_start", { mode: "string" }).notNull(),
    limitMinor: minorUnits("limit_minor").notNull(),
    currency: currency("currency"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_unique_period_idx").on(
      table.householdId,
      table.categoryId,
      table.periodStart,
    ),
    index("budget_household_period_idx").on(table.householdId, table.periodStart),
  ],
);

export const recurringRules = pgTable(
  "recurring_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    paidByUserId: text("paid_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** See households.slug — seeded rows only. */
    slug: text("slug"),
    type: transactionTypeEnum("type").notNull(),
    amountMinor: minorUnits("amount_minor").notNull(),
    currency: currency("currency"),
    note: text("note"),
    /** See transactions.noteSlug. */
    noteSlug: text("note_slug"),
    frequency: frequencyEnum("frequency").notNull(),
    interval: integer("interval").notNull().default(1),
    startOn: date("start_on", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    nextRunOn: date("next_run_on", { mode: "string" }).notNull(),
    lastMaterializedOn: date("last_materialized_on", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recurring_household_idx").on(table.householdId),
    index("recurring_next_run_idx").on(table.nextRunOn),
  ],
);

export const goals = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** See households.slug — seeded rows only. */
    slug: text("slug"),
    targetMinor: minorUnits("target_minor").notNull(),
    currency: currency("currency"),
    targetDate: date("target_date", { mode: "string" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("goal_household_idx").on(table.householdId)],
);

export const goalContributions = pgTable(
  "goal_contribution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    amountMinor: minorUnits("amount_minor").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("goal_contribution_goal_idx").on(table.goalId)],
);

/**
 * The Apple Pay webhook's per-household state: its secret and what it last
 * saw. One row per household, created on the first rotation or the first
 * request — the household id is the key.
 *
 * The secret is stored as a SHA-256 hash, not encrypted: it is 32 random bytes,
 * so there is no dictionary to run a fast hash against, and the server only
 * ever needs to compare, never to read it back. That is also why the UI can
 * show it exactly once.
 */
export const walletWebhooks = pgTable("wallet_webhook", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  /** Null while the household still relies on WALLET_WEBHOOK_SECRET. */
  secretHash: text("secret_hash"),
  /** Last four characters, so the settings screen can say which one is live. */
  secretHint: text("secret_hint"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  lastTransactionId: uuid("last_transaction_id").references(
    () => transactions.id,
    { onDelete: "set null" },
  ),
  /** The last rejection's message, as the shortcut was told it. */
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- relations ------------------------------------------------------------

export const householdRelations = relations(households, ({ many }) => ({
  users: many(users),
  accounts: many(accounts),
  categories: many(categories),
  transactions: many(transactions),
}));

export const userRelations = relations(users, ({ one }) => ({
  household: one(households, {
    fields: [users.householdId],
    references: [households.id],
  }),
}));

export const accountRelations = relations(accounts, ({ one, many }) => ({
  household: one(households, {
    fields: [accounts.householdId],
    references: [households.id],
  }),
  transactions: many(transactions),
}));

export const categoryRelations = relations(categories, ({ one, many }) => ({
  household: one(households, {
    fields: [categories.householdId],
    references: [households.id],
  }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  transactions: many(transactions),
}));

export const transactionRelations = relations(transactions, ({ one }) => ({
  household: one(households, {
    fields: [transactions.householdId],
    references: [households.id],
  }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  paidBy: one(users, {
    fields: [transactions.paidByUserId],
    references: [users.id],
  }),
}));

export const budgetRelations = relations(budgets, ({ one }) => ({
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const goalRelations = relations(goals, ({ many }) => ({
  contributions: many(goalContributions),
}));

export const goalContributionRelations = relations(
  goalContributions,
  ({ one }) => ({
    goal: one(goals, {
      fields: [goalContributions.goalId],
      references: [goals.id],
    }),
  }),
);

export const recurringRuleRelations = relations(recurringRules, ({ one }) => ({
  account: one(accounts, {
    fields: [recurringRules.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [recurringRules.categoryId],
    references: [categories.id],
  }),
}));

// --- inferred row types ---------------------------------------------------

export type Household = typeof households.$inferSelect;
export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type RecurringRule = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type GoalContribution = typeof goalContributions.$inferSelect;
export type AccountType = (typeof accountTypeEnum.enumValues)[number];
export type CategoryKind = (typeof categoryKindEnum.enumValues)[number];
export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];
export type RecurrenceFrequency = (typeof frequencyEnum.enumValues)[number];
export type TransactionSource = (typeof transactionSourceEnum.enumValues)[number];
export type WalletWebhook = typeof walletWebhooks.$inferSelect;
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
