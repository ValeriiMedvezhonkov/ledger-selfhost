import { config } from "dotenv";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { addDays, addMonths, startOfMonth, subMonths } from "date-fns";
import * as schema from "./schema";
import {
  ONE_TO_ONE,
  negateMinor,
  splitMinor,
  toMinor,
  toScaledRate,
} from "@/lib/money";
import { toISODate } from "@/lib/date";
import { assertLocalDatabase } from "./guard";
import { SK_CATEGORIES } from "@/lib/merchants";
import { secretHint } from "@/lib/wallet-webhook";

config({ path: ".env", quiet: true });

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");

const allowed = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);

assertLocalDatabase("replace every finance row with sample data");

const BASE_CURRENCY = process.env.APP_BASE_CURRENCY ?? "EUR";

/*
 * A year in the life of a two-person household in Bratislava, written so that
 * every state the iOS 27 screens can draw has real rows behind it:
 *
 *  - provenance: Apple Pay taps with a clock time (the last six weeks, since
 *    the Wallet webhook went live), monthly bank-statement imports carrying
 *    the raw card line as their note (before that), recurring-rule rows, and
 *    hand-typed cash entries — some typed by one partner for the other;
 *  - «пополам»: the big weekly shop and dinners out, split into two halves;
 *  - transfers to savings, ATM withdrawals into cash, Revolut top-ups, and a
 *    weekend in Prague paid in CZK;
 *  - rules that are monthly, yearly and paused; budgets under, over and
 *    «оплачено»; goals in progress and one achieved; an archived card;
 *  - the Apple Pay webhook's status with a last tap.
 *
 * Household members, their passwords, sessions, passkeys and the sign-in log
 * are KEPT: only finance data is replaced. Members are created only when the
 * database has none yet.
 */

/**
 * Slovak seed name → stable key, so the UI shows a shipped category in the
 * reader's language. The stored name stays as the fallback.
 */
const SLUG_BY_SEED_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(SK_CATEGORIES).map(([key, name]) => [name, key]),
);

/**
 * The app's own words — starter accounts, goals, rules and generic titles —
 * stamped with a slug so they read in the interface language until somebody
 * edits them. Shop names and anything the two of you typed (the Russian
 * notes) deliberately have none: those read the same in every language.
 */
const SEEDED_SLUGS: ReadonlyMap<string, string> = new Map([
  ["Home", "householdHome"],
  ["Current account", "accountCurrent"],
  ["Savings", "accountSavings"],
  ["Cash", "accountCash"],
  ["Old card", "accountOldCard"],
  ["Holiday", "goalHoliday"],
  ["Six-month buffer", "goalBuffer"],
  ["Trip to Japan", "goalJapan"],
  ["Nájom", "ruleRent"],
  ["O2 paušál", "rulePhonePlan"],
  ["DPB predplatný lístok", "noteTransitPass"],
  ["Darček", "noteGift"],
  ["Darček k narodeninám", "noteBirthdayGift"],
  ["Faktúra", "noteInvoice"],
  ["Kaderníctvo", "noteHairdresser"],
  ["Kaviareň", "noteCafe"],
  ["Kvety", "noteFlowers"],
  ["Letenky", "noteFlights"],
  ["Na sporenie", "noteToSavings"],
  ["Nájom + energie", "noteRentUtils"],
  ["Obed v práci", "noteLunchAtWork"],
  ["Parkovanie PAAS", "noteParking"],
  ["Pizza", "notePizza"],
  ["Poliklinika", "noteClinic"],
  ["Poplatok za vedenie účtu", "noteAccountFee"],
  ["Víkend v Prahe", "notePragueWeekend"],
  ["Výber z bankomatu", "noteAtmWithdrawal"],
  ["Výplata", "noteSalary"],
  ["Z bežného účtu", "noteFromCurrent"],
  ["Zubár", "noteDentist"],
  ["Aquapark", "noteWaterpark"],
  ["Barber", "noteBarber"],
  ["Fitness členské", "noteGymMembership"],
  ["Ubytovanie Tatry", "noteTatrasStay"],
  ["Diaľničná známka", "noteVignette"],
  ["Hotel + večera, 2 noci", "notePragueHotel"],
]);

function seededSlug(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : (SEEDED_SLUGS.get(value) ?? null);
}

/** .env.example ships the names as "", which means "not set", not "no name". */
function seedName(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === "" ? fallback : value;
}

const MEMBER_A_NAME = seedName(process.env.SEED_MEMBER_A_NAME, "Alex");
const MEMBER_B_NAME = seedName(process.env.SEED_MEMBER_B_NAME, "Sam");
const MEMBER_A_EMOJI = "🐒";
const MEMBER_B_EMOJI = "🐻";

/**
 * Deterministic PRNG (mulberry32): the ledger is identical on every run, so
 * "the dashboard looks different" never becomes a debugging session.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20261002);

function pick<T>(items: readonly T[]): T {
  const value = items[Math.floor(random() * items.length)];
  if (value === undefined) throw new Error("pick() from an empty list");
  return value;
}

function between(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** A euro amount with believable cents (12,49 rather than 12,00). */
function euros(min: number, max: number): number {
  return between(min * 100, max * 100);
}

interface CategorySeed {
  readonly name: string;
  readonly kind: "income" | "expense";
  readonly icon: string;
  readonly color: string;
  /** Typical size of one payment, in euros. */
  readonly low: number;
  readonly high: number;
  /** How often it turns up among day-to-day spending; 0 = only explicitly. */
  readonly weight: number;
}

/**
 * Slovak categories. Colours are the validated slots from
 * lib/chart-palette.ts; names come from SK_CATEGORIES so merchant matching on
 * import and on Apple Pay taps lands on a category that exists.
 */
const CATEGORY_SEEDS: readonly CategorySeed[] = [
  {
    name: SK_CATEGORIES.salary,
    kind: "income",
    icon: "Wallet",
    color: "#008300",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.freelance,
    kind: "income",
    icon: "Laptop",
    color: "#1baf7a",
    low: 0,
    high: 0,
    weight: 0,
  },

  {
    name: SK_CATEGORIES.groceries,
    kind: "expense",
    icon: "ShoppingCart",
    color: "#eb6834",
    low: 4,
    high: 48,
    weight: 30,
  },
  {
    name: SK_CATEGORIES.housing,
    kind: "expense",
    icon: "House",
    color: "#2a78d6",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.restaurants,
    kind: "expense",
    icon: "UtensilsCrossed",
    color: "#e34948",
    low: 4,
    high: 38,
    weight: 14,
  },
  {
    name: SK_CATEGORIES.transport,
    kind: "expense",
    icon: "Bus",
    color: "#1baf7a",
    low: 2,
    high: 24,
    weight: 6,
  },
  {
    name: SK_CATEGORIES.fuel,
    kind: "expense",
    icon: "Fuel",
    color: "#4a3aa7",
    low: 38,
    high: 72,
    weight: 4,
  },
  {
    name: SK_CATEGORIES.utilities,
    kind: "expense",
    icon: "Zap",
    color: "#eda100",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.telecom,
    kind: "expense",
    icon: "Smartphone",
    color: "#898781",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.health,
    kind: "expense",
    icon: "HeartPulse",
    color: "#e87ba4",
    low: 4,
    high: 45,
    weight: 4,
  },
  {
    name: SK_CATEGORIES.drugstore,
    kind: "expense",
    icon: "Sparkles",
    color: "#e87ba4",
    low: 5,
    high: 38,
    weight: 6,
  },
  {
    name: SK_CATEGORIES.clothing,
    kind: "expense",
    icon: "Shirt",
    color: "#e34948",
    low: 18,
    high: 120,
    weight: 3,
  },
  {
    name: SK_CATEGORIES.electronics,
    kind: "expense",
    icon: "Laptop",
    color: "#2a78d6",
    low: 15,
    high: 260,
    weight: 1,
  },
  {
    name: SK_CATEGORIES.home,
    kind: "expense",
    icon: "Sofa",
    color: "#eb6834",
    low: 6,
    high: 140,
    weight: 3,
  },
  {
    name: SK_CATEGORIES.entertainment,
    kind: "expense",
    icon: "Clapperboard",
    color: "#4a3aa7",
    low: 6,
    high: 40,
    weight: 4,
  },
  {
    name: SK_CATEGORIES.sport,
    kind: "expense",
    icon: "Dumbbell",
    color: "#1baf7a",
    low: 8,
    high: 65,
    weight: 2,
  },
  {
    name: SK_CATEGORIES.beauty,
    kind: "expense",
    icon: "Scissors",
    color: "#e87ba4",
    low: 12,
    high: 45,
    weight: 2,
  },
  {
    name: SK_CATEGORIES.travel,
    kind: "expense",
    icon: "Plane",
    color: "#eda100",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.insurance,
    kind: "expense",
    icon: "ShieldCheck",
    color: "#898781",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.fees,
    kind: "expense",
    icon: "Landmark",
    color: "#898781",
    low: 0,
    high: 0,
    weight: 0,
  },
  {
    name: SK_CATEGORIES.gifts,
    kind: "expense",
    icon: "Gift",
    color: "#e34948",
    low: 10,
    high: 70,
    weight: 2,
  },
];

/** Where the money actually goes, by category — real Slovak names. */
const MERCHANTS: Readonly<Record<string, readonly string[]>> = {
  [SK_CATEGORIES.groceries]: [
    "Lidl",
    "Lidl",
    "Kaufland",
    "Tesco",
    "Billa",
    "COOP Jednota",
    "Terno",
    "Yeme",
    "Rohlík",
  ],
  [SK_CATEGORIES.restaurants]: [
    "Wolt",
    "Bolt Food",
    "McDonald's",
    "KFC",
    "Obed v práci",
    "Kaviareň",
    "Pizza",
    "Bageteria Boulevard",
    "Starbucks",
  ],
  [SK_CATEGORIES.transport]: [
    "Bolt",
    "Parkovanie PAAS",
    "ZSSK",
    "RegioJet",
    "Slovak Lines",
  ],
  [SK_CATEGORIES.fuel]: ["Slovnaft", "Slovnaft", "OMV", "Shell"],
  [SK_CATEGORIES.health]: [
    "Dr. Max",
    "BENU",
    "Pilulka",
    "Poliklinika",
    "Zubár",
  ],
  [SK_CATEGORIES.drugstore]: ["dm drogerie", "Rossmann", "TETA drogérie"],
  [SK_CATEGORIES.clothing]: [
    "Zara Eurovea",
    "H&M Aupark",
    "Reserved",
    "CCC",
    "Deichmann",
    "Sinsay",
  ],
  [SK_CATEGORIES.electronics]: ["Alza", "NAY", "Datart", "iStores"],
  [SK_CATEGORIES.home]: [
    "IKEA Bratislava",
    "JYSK",
    "Hornbach",
    "OBI",
    "Pepco",
    "TEDi",
  ],
  [SK_CATEGORIES.entertainment]: [
    "CineMax Bory Mall",
    "Cinema City Eurovea",
    "Steam",
    "Martinus",
  ],
  [SK_CATEGORIES.sport]: ["Decathlon", "Hervis", "Sportisimo", "GymBeam"],
  [SK_CATEGORIES.beauty]: ["Notino", "Kaderníctvo", "Barber"],
  [SK_CATEGORIES.gifts]: ["Kvety", "Darček", "Darček k narodeninám"],
};

/** Online shops: bought with a card number, never a tap and never cash. */
const ONLINE = new Set([
  "Wolt",
  "Bolt Food",
  "Rohlík",
  "Pilulka",
  "Notino",
  "Steam",
  "GymBeam",
  "Alza",
  "Martinus",
]);

/** Spent from cash, when the wallet has it. */
const CASH_FRIENDLY = new Set([
  "Kaviareň",
  "Pizza",
  "Parkovanie PAAS",
  "COOP Jednota",
  "Kvety",
  "Barber",
  "Terno",
]);

/**
 * What the two of you actually wrote in the note field — in Russian, as typed.
 * No slug: a note someone wrote is theirs, not the app's.
 */
const NOTES_BY_MERCHANT: Readonly<Record<string, readonly string[]>> = {
  Slovnaft: ["Полный бак перед поездкой в Žilina", "Заправка + мойка"],
  OMV: ["Полный бак"],
  "IKEA Bratislava": ["Полки в спальню", "Лампа и коврики"],
  Alza: ["Наушники для Жени", "Кабель USB-C и зарядка"],
  "Dr. Max": ["Витамины D и магний", "От простуды"],
  Kvety: ["Маме на день рождения"],
  "Darček k narodeninám": ["Подарок Маше"],
  Pizza: ["Пятничный вечер"],
  Decathlon: ["Кроссовки для бега"],
  Zubár: ["Чистка + пломба"],
  "Zara Eurovea": ["Пальто на осень"],
  Kaufland: ["Закупка на неделю"],
};

/** The city a card terminal reports, for imported statement lines. */
const CITIES = [
  "BRATISLAVA",
  "BRATISLAVA",
  "BRATISLAVA",
  "SENEC",
  "TRNAVA",
  "PEZINOK",
];

function statementLine(merchant: string, last4: string): string {
  const shop = merchant
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 &.-]/g, "");
  return `NAKUP KARTOU ${last4} ${shop} ${pick(CITIES)}`;
}

type TxInsert = typeof schema.transactions.$inferInsert;

async function main(connectionString: string): Promise<void> {
  const needsSsl =
    connectionString.includes("neon.tech") ||
    connectionString.includes("sslmode=require");
  const pool = new Pool({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const db = drizzle(pool, { schema });
  const now = new Date();
  const today = toISODate(now);

  try {
    /* ------------------------------------------------- members, household */

    const emails =
      allowed.length >= 2
        ? allowed.slice(0, 2)
        : ["you@example.com", "partner@example.com"];
    const [emailA, emailB] = emails;
    if (emailA === undefined || emailB === undefined) {
      throw new Error("need two allowlisted emails to seed");
    }

    const existing = await db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.email, [emailA, emailB]));

    // Reuse the members' household when there is one; otherwise make it.
    let householdId =
      existing.find((user) => user.householdId !== null)?.householdId ?? null;
    if (householdId === null) {
      const [created] = await db
        .insert(schema.households)
        .values({
          name: "Home",
          slug: seededSlug("Home"),
          baseCurrency: BASE_CURRENCY,
        })
        .returning();
      if (!created) throw new Error("failed to create household");
      householdId = created.id;
    }

    console.log(
      "· clearing finance data (members, passwords and sessions are kept)",
    );
    await db
      .delete(schema.walletWebhooks)
      .where(eq(schema.walletWebhooks.householdId, householdId));
    await db
      .delete(schema.quickPicks)
      .where(eq(schema.quickPicks.householdId, householdId));
    const oldGoals = await db
      .select({ id: schema.goals.id })
      .from(schema.goals)
      .where(eq(schema.goals.householdId, householdId));
    if (oldGoals.length > 0) {
      await db.delete(schema.goalContributions).where(
        inArray(
          schema.goalContributions.goalId,
          oldGoals.map((goal) => goal.id),
        ),
      );
    }
    await db
      .delete(schema.goals)
      .where(eq(schema.goals.householdId, householdId));
    await db
      .delete(schema.budgets)
      .where(eq(schema.budgets.householdId, householdId));
    // Transfer links and goal contributions cascade / set null with these.
    await db
      .delete(schema.transactions)
      .where(eq(schema.transactions.householdId, householdId));
    await db
      .delete(schema.recurringRules)
      .where(eq(schema.recurringRules.householdId, householdId));
    await db
      .delete(schema.categories)
      .where(eq(schema.categories.householdId, householdId));
    await db
      .delete(schema.accounts)
      .where(eq(schema.accounts.householdId, householdId));

    const ensureMember = async (
      email: string,
      name: string,
      color: string,
      emoji: string,
    ): Promise<schema.User> => {
      const found = existing.find((user) => user.email === email);
      if (found) {
        const [updated] = await db
          .update(schema.users)
          .set({
            householdId,
            // Only fill what the app has never been told; renames stay.
            ...(found.avatarEmoji === null ? { avatarEmoji: emoji } : {}),
            ...(found.displayName === null ? { displayName: name } : {}),
          })
          .where(eq(schema.users.id, found.id))
          .returning();
        if (!updated) throw new Error(`failed to update ${email}`);
        return updated;
      }
      const [created] = await db
        .insert(schema.users)
        .values({
          email,
          name,
          displayName: name,
          color,
          avatarEmoji: emoji,
          householdId,
          emailVerified: now,
        })
        .returning();
      if (!created) throw new Error(`failed to create ${email}`);
      return created;
    };

    const userA = await ensureMember(
      emailA,
      MEMBER_A_NAME,
      "#2a78d6",
      MEMBER_A_EMOJI,
    );
    const userB = await ensureMember(
      emailB,
      MEMBER_B_NAME,
      "#e87ba4",
      MEMBER_B_EMOJI,
    );
    const other = (id: string) => (id === userA.id ? userB.id : userA.id);

    /* ------------------------------------------------------------ accounts */

    console.log("· accounts");
    const archivedOn = new Date(now.getFullYear(), 4, 18);
    const [current, savings, cash, revolut, oldCard] = await db
      .insert(schema.accounts)
      .values([
        {
          householdId,
          name: "Current account",
          slug: seededSlug("Current account"),
          type: "checking",
          currency: BASE_CURRENCY,
          openingBalanceMinor: toMinor(312_480),
          sortOrder: 0,
          isDefault: true,
        },
        {
          householdId,
          name: "Savings",
          slug: seededSlug("Savings"),
          type: "savings",
          currency: BASE_CURRENCY,
          openingBalanceMinor: toMinor(410_000),
          sortOrder: 1,
        },
        {
          householdId,
          name: "Cash",
          slug: seededSlug("Cash"),
          type: "cash",
          currency: BASE_CURRENCY,
          openingBalanceMinor: toMinor(6_500),
          sortOrder: 2,
        },
        {
          householdId,
          name: "Revolut",
          type: "checking",
          currency: BASE_CURRENCY,
          openingBalanceMinor: toMinor(4_200),
          sortOrder: 3,
        },
        // Closed in May: the «Архив» section on Счета.
        {
          householdId,
          name: "Old card",
          slug: seededSlug("Old card"),
          type: "credit",
          currency: BASE_CURRENCY,
          openingBalanceMinor: toMinor(0),
          sortOrder: 4,
          archivedAt: archivedOn <= now ? archivedOn : subMonths(now, 4),
        },
      ])
      .returning();
    if (!current || !savings || !cash || !revolut || !oldCard)
      throw new Error("failed to create accounts");

    /* ---------------------------------------------------------- categories */

    console.log("· categories");
    const insertedCategories = await db
      .insert(schema.categories)
      .values([
        ...CATEGORY_SEEDS.map((seed) => ({
          householdId,
          name: seed.name,
          slug: SLUG_BY_SEED_NAME.get(seed.name) ?? null,
          kind: seed.kind,
          icon: seed.icon,
          color: seed.color,
        })),
        {
          householdId,
          name: "Nezaradené",
          slug: "uncategorised",
          kind: "expense" as const,
          icon: "CircleHelp",
          color: "#898781",
          isSystem: true,
        },
      ])
      .returning();
    const categoryByName = new Map(
      insertedCategories.map((row) => [row.name, row]),
    );
    const cat = (name: string): string => {
      const found = categoryByName.get(name);
      if (!found) throw new Error(`missing seeded category ${name}`);
      return found.id;
    };

    /* ------------------------------------------------------ recurring rules */

    console.log("· recurring rules");
    interface RuleSeed {
      readonly name: string;
      readonly category: string;
      readonly amount: number;
      readonly paidBy: string;
      readonly day: number;
      readonly frequency: "monthly" | "yearly";
      /** Yearly rules: the month (0-11) they fall in. */
      readonly month?: number;
      readonly note?: string;
      /** Paused this many months ago (rows stop there). */
      readonly pausedMonthsAgo?: number;
    }
    const RULES: readonly RuleSeed[] = [
      {
        name: "Nájom",
        category: SK_CATEGORIES.housing,
        amount: 89_000,
        paidBy: userA.id,
        day: 1,
        frequency: "monthly",
        note: "Nájom + energie",
      },
      {
        name: "DPB predplatný lístok",
        category: SK_CATEGORIES.transport,
        amount: 2_690,
        paidBy: userB.id,
        day: 1,
        frequency: "monthly",
      },
      {
        name: "O2 paušál",
        category: SK_CATEGORIES.telecom,
        amount: 1_800,
        paidBy: userB.id,
        day: 5,
        frequency: "monthly",
      },
      {
        name: "Telekom internet",
        category: SK_CATEGORIES.telecom,
        amount: 2_490,
        paidBy: userA.id,
        day: 10,
        frequency: "monthly",
      },
      {
        name: "Netflix",
        category: SK_CATEGORIES.entertainment,
        amount: 1_399,
        paidBy: userA.id,
        day: 14,
        frequency: "monthly",
      },
      {
        name: "Spotify Duo",
        category: SK_CATEGORIES.entertainment,
        amount: 1_699,
        paidBy: userB.id,
        day: 21,
        frequency: "monthly",
      },
      {
        name: "Fitness členské",
        category: SK_CATEGORIES.sport,
        amount: 4_900,
        paidBy: userA.id,
        day: 3,
        frequency: "monthly",
        pausedMonthsAgo: 2,
      },
      {
        name: "Union PZP",
        category: SK_CATEGORIES.insurance,
        amount: 28_940,
        paidBy: userA.id,
        day: 15,
        frequency: "yearly",
        month: 2,
      },
    ];

    /** Every occurrence of a rule from a year ago to today, oldest first. */
    const occurrences = (rule: RuleSeed): Date[] => {
      const dates: Date[] = [];
      for (let offset = 11; offset >= 0; offset -= 1) {
        const month = startOfMonth(subMonths(now, offset));
        if (rule.frequency === "yearly" && month.getMonth() !== rule.month)
          continue;
        if (rule.pausedMonthsAgo !== undefined && offset < rule.pausedMonthsAgo)
          continue;
        const date = addDays(month, rule.day - 1);
        if (date <= now) dates.push(date);
      }
      return dates;
    };
    /** The first occurrence after today — the dashboard must not re-create one. */
    const nextRun = (rule: RuleSeed): Date => {
      let month = startOfMonth(now);
      for (let i = 0; i < 24; i += 1) {
        const candidate = addDays(month, rule.day - 1);
        if (
          candidate > now &&
          (rule.frequency === "monthly" || candidate.getMonth() === rule.month)
        ) {
          return candidate;
        }
        month = addMonths(month, 1);
      }
      throw new Error(`no next run for ${rule.name}`);
    };

    const insertedRules = await db
      .insert(schema.recurringRules)
      .values(
        RULES.map((rule) => ({
          householdId,
          accountId: current.id,
          categoryId: cat(rule.category),
          paidByUserId: rule.paidBy,
          name: rule.name,
          slug: seededSlug(rule.name),
          type: "expense" as const,
          amountMinor: toMinor(-rule.amount),
          currency: BASE_CURRENCY,
          note: rule.note ?? null,
          noteSlug: seededSlug(rule.note),
          frequency: rule.frequency,
          interval: 1,
          startOn: toISODate(occurrences(rule)[0] ?? now),
          nextRunOn: toISODate(nextRun(rule)),
          active: rule.pausedMonthsAgo === undefined,
        })),
      )
      .returning({
        id: schema.recurringRules.id,
        name: schema.recurringRules.name,
      });
    const ruleId = (name: string): string => {
      const found = insertedRules.find((rule) => rule.name === name);
      if (!found) throw new Error(`missing rule ${name}`);
      return found.id;
    };

    /* -------------------------------------------------------- transactions */

    console.log("· transactions");
    const rows: TxInsert[] = [];
    const tapCutoff = addDays(now, -45);
    const card = { [userA.id]: "4532", [userB.id]: "8817" } as const;

    interface Entry {
      readonly category: string;
      readonly cents: number;
      readonly on: Date;
      readonly merchant: string;
      readonly paidBy: string;
      readonly accountId?: string;
      readonly type?: "income" | "expense";
      readonly note?: string | null;
      readonly time?: Date;
      readonly source?: "manual" | "apple_pay" | "import" | "recurring";
      readonly recurringRuleId?: string;
      readonly splitGroupId?: string;
      readonly createdBy?: string;
    }

    const add = (entry: Entry): void => {
      const type = entry.type ?? "expense";
      const amount = toMinor(type === "expense" ? -entry.cents : entry.cents);
      const accountId = entry.accountId ?? current.id;
      const online = ONLINE.has(entry.merchant);
      /*
       * Provenance follows how this household really records: card payments
       * at a terminal are Apple Pay taps since the Wallet webhook went live
       * (tapCutoff), before that they came in with the monthly statement
       * import; cash and the odd forgotten one are typed in by hand.
       */
      const source =
        entry.source ??
        (accountId === cash.id
          ? "manual"
          : accountId === current.id &&
              entry.on >= tapCutoff &&
              !online &&
              type === "expense"
            ? "apple_pay"
            : accountId === current.id && entry.on < tapCutoff
              ? "import"
              : "manual");
      // A bank statement knows the day, never the time.
      const time =
        source === "import"
          ? undefined
          : (entry.time ??
            (source === "apple_pay" ||
            (source === "manual" && entry.on >= tapCutoff)
              ? new Date(
                  entry.on.getFullYear(),
                  entry.on.getMonth(),
                  entry.on.getDate(),
                  between(8, 20),
                  between(0, 59),
                )
              : undefined));
      const typedNote =
        entry.note !== undefined
          ? entry.note
          : random() < 0.35
            ? NOTES_BY_MERCHANT[entry.merchant]
              ? pick(NOTES_BY_MERCHANT[entry.merchant] ?? [])
              : null
            : null;
      const note =
        source === "import" && typedNote === null && type === "expense"
          ? statementLine(entry.merchant, card[entry.paidBy] ?? "4532")
          : typedNote;
      // A tap comes from the payer's own phone; a hand-typed entry is made
      // for the other partner about one time in four.
      const createdBy =
        entry.createdBy ??
        (source === "manual" && random() < 0.25
          ? other(entry.paidBy)
          : entry.paidBy);

      rows.push({
        householdId,
        accountId,
        categoryId: cat(entry.category),
        createdByUserId: createdBy,
        paidByUserId: entry.paidBy,
        type,
        amountMinor: amount,
        currency: BASE_CURRENCY,
        fxRateToBase: ONE_TO_ONE,
        amountBaseMinor: amount,
        occurredOn: toISODate(entry.on),
        occurredAt: time !== undefined && time <= now ? time : null,
        merchant: entry.merchant,
        merchantSlug: seededSlug(entry.merchant),
        note,
        noteSlug: seededSlug(note),
        source,
        recurringRuleId: entry.recurringRuleId ?? null,
        splitGroupId: entry.splitGroupId ?? null,
        // A tap is recorded the moment it happens; everything else was typed
        // or imported a little later.
        createdAt:
          time !== undefined && time <= now
            ? time
            : addDays(entry.on, source === "import" ? 3 : 0),
      });
    };

    /** «Пополам»: two halves, one per partner, sharing a split group. */
    const addSplit = (entry: Omit<Entry, "paidBy">, payer: string): void => {
      const [first, second] = splitMinor(toMinor(entry.cents));
      const group = randomUUID();
      const time =
        entry.time ??
        new Date(
          entry.on.getFullYear(),
          entry.on.getMonth(),
          entry.on.getDate(),
          between(11, 20),
          between(0, 59),
        );
      add({
        ...entry,
        cents: first,
        paidBy: payer,
        createdBy: payer,
        splitGroupId: group,
        time,
      });
      add({
        ...entry,
        cents: second,
        paidBy: other(payer),
        createdBy: payer,
        splitGroupId: group,
        time,
        note: null,
      });
    };

    // Recurring rows, linked to their rules.
    for (const rule of RULES) {
      for (const date of occurrences(rule)) {
        add({
          category: rule.category,
          cents: rule.amount,
          on: date,
          merchant: rule.name,
          paidBy: rule.paidBy,
          note: rule.note ?? null,
          source: "recurring",
          recurringRuleId: ruleId(rule.name),
        });
      }
    }

    const expenseSeeds = CATEGORY_SEEDS.filter(
      (seed) => seed.kind === "expense" && seed.weight > 0,
    );
    const weighted: CategorySeed[] = expenseSeeds.flatMap((seed) =>
      Array<CategorySeed>(seed.weight).fill(seed),
    );

    for (let offset = 11; offset >= 0; offset -= 1) {
      const monthStart = startOfMonth(subMonths(now, offset));
      const isCurrent = offset === 0;
      const lastDay = isCurrent
        ? now.getDate()
        : new Date(
            monthStart.getFullYear(),
            monthStart.getMonth() + 1,
            0,
          ).getDate();
      const day = (d: number) => addDays(monthStart, Math.min(d, lastDay) - 1);
      const winter = [10, 11, 0, 1, 2].includes(monthStart.getMonth());

      // Salaries arrive by bank transfer and come in with the statement.
      if (!isCurrent || now.getDate() >= 12) {
        add({
          type: "income",
          category: SK_CATEGORIES.salary,
          cents: euros(1_380, 1_520),
          on: day(12),
          merchant: "Výplata",
          paidBy: userB.id,
          source: "import",
          note: null,
        });
      }
      if (!isCurrent || now.getDate() >= 15) {
        add({
          type: "income",
          category: SK_CATEGORIES.salary,
          cents: euros(1_960, 2_120),
          on: day(15),
          merchant: "Výplata",
          paidBy: userA.id,
          source: "import",
          note: null,
        });
      }
      if (!isCurrent && random() > 0.55) {
        add({
          type: "income",
          category: SK_CATEGORIES.freelance,
          cents: euros(180, 640),
          on: day(between(5, 25)),
          merchant: "Faktúra",
          paidBy: userB.id,
          source: "manual",
          note: null,
        });
      }

      // Energy: electricity steady, gas follows the season.
      if (!isCurrent || now.getDate() >= 8) {
        add({
          category: SK_CATEGORIES.utilities,
          cents: euros(54, 72),
          on: day(8),
          merchant: "ZSE Energia",
          paidBy: userA.id,
          source: offset >= 2 ? "import" : "manual",
          note: null,
        });
        add({
          category: SK_CATEGORIES.utilities,
          cents: winter ? euros(88, 124) : euros(26, 38),
          on: day(9),
          merchant: "SPP",
          paidBy: userA.id,
          source: offset >= 2 ? "import" : "manual",
          note: null,
        });
      }
      if (!isCurrent && monthStart.getMonth() % 3 === 0) {
        add({
          category: SK_CATEGORIES.utilities,
          cents: euros(38, 52),
          on: day(20),
          merchant: "BVS",
          paidBy: userB.id,
          source: offset >= 2 ? "import" : "manual",
          note: null,
        });
      }
      // The account keeps a small monthly fee.
      if (!isCurrent) {
        add({
          category: SK_CATEGORIES.fees,
          cents: 290,
          on: day(lastDay),
          merchant: "Poplatok za vedenie účtu",
          paidBy: userA.id,
          source: offset >= 2 ? "import" : "manual",
          note: null,
        });
      }

      // The weekly shop, split down the middle, and a dinner out or two.
      for (const week of [3, 10, 17, 24]) {
        if (week > lastDay) continue;
        addSplit(
          {
            category: SK_CATEGORIES.groceries,
            cents: euros(62, 138),
            on: day(week),
            merchant: pick(["Kaufland", "Tesco", "Kaufland", "Lidl"]),
          },
          pick([userA.id, userB.id]),
        );
      }
      for (let i = 0; i < (isCurrent ? 0 : between(1, 2)); i += 1) {
        addSplit(
          {
            category: SK_CATEGORIES.restaurants,
            cents: euros(42, 96),
            on: day(between(4, 27)),
            merchant: pick(["Pizza", "Bageteria Boulevard", "Wolt"]),
          },
          pick([userA.id, userB.id]),
        );
      }

      // Day-to-day spending.
      const count = isCurrent ? 0 : between(22, 30);
      for (let i = 0; i < count; i += 1) {
        const seed = pick(weighted);
        const merchant = pick(MERCHANTS[seed.name] ?? ["?"]);
        const paidBy = random() < 0.55 ? userA.id : userB.id;
        const accountId =
          CASH_FRIENDLY.has(merchant) && random() < 0.6
            ? cash.id
            : ONLINE.has(merchant) && random() < 0.5
              ? revolut.id
              : current.id;
        add({
          category: seed.name,
          cents: euros(seed.low, seed.high),
          on: day(between(1, lastDay)),
          merchant,
          paidBy,
          accountId,
        });
      }
    }

    // Seasonal and one-off spending that makes a year look like a year.
    const monthsAgo = (n: number, d: number) =>
      addDays(startOfMonth(subMonths(now, n)), d - 1);
    add({
      category: SK_CATEGORIES.travel,
      cents: 41_200,
      on: monthsAgo(3, 12),
      merchant: "Ubytovanie Tatry",
      paidBy: userA.id,
      note: "Štrbské Pleso, 3 noci",
    });
    add({
      category: SK_CATEGORIES.travel,
      cents: 1_200,
      on: monthsAgo(3, 12),
      merchant: "Diaľničná známka",
      paidBy: userA.id,
      accountId: revolut.id,
    });
    add({
      category: SK_CATEGORIES.travel,
      cents: 2_850,
      on: monthsAgo(3, 14),
      merchant: "Aquapark",
      paidBy: userB.id,
    });
    add({
      category: SK_CATEGORIES.travel,
      cents: 38_600,
      on: monthsAgo(7, 20),
      merchant: "Letenky",
      paidBy: userB.id,
      accountId: revolut.id,
      note: "Bratislava → Tokio, на двоих",
    });
    add({
      category: SK_CATEGORIES.electronics,
      cents: 129_900,
      on: monthsAgo(10, 6),
      merchant: "iStores",
      paidBy: userA.id,
      note: "MacBook Air",
    });
    add({
      category: SK_CATEGORIES.gifts,
      cents: 8_900,
      on: monthsAgo(9, 22),
      merchant: "Martinus",
      paidBy: userB.id,
      note: "Книги на Рождество",
    });
    add({
      category: SK_CATEGORIES.home,
      cents: 21_480,
      on: monthsAgo(5, 9),
      merchant: "IKEA Bratislava",
      paidBy: userA.id,
      note: "Полки в спальню",
    });

    // The last few days, so Обзор and Операции open on something current.
    const yesterday = addDays(startOfMonth(now), now.getDate() - 2);
    if (now.getDate() >= 2) {
      add({
        category: SK_CATEGORIES.groceries,
        cents: 3_460,
        on: yesterday,
        merchant: "Lidl",
        paidBy: userB.id,
        time: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          10,
          15,
        ),
      });
      add({
        category: SK_CATEGORIES.restaurants,
        cents: 3_380,
        on: yesterday,
        merchant: "Bageteria Boulevard",
        paidBy: userA.id,
        time: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          13,
          5,
        ),
      });
      add({
        category: SK_CATEGORIES.restaurants,
        cents: 1_890,
        on: yesterday,
        merchant: "Pizza",
        paidBy: userA.id,
        accountId: cash.id,
        note: "Ужин после работы",
      });
    }
    {
      const at = (h: number, m: number) =>
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const morning = at(8, 12);
      if (morning <= now)
        add({
          category: SK_CATEGORIES.restaurants,
          cents: 380,
          on: now,
          merchant: "Kaviareň",
          paidBy: userB.id,
          time: morning,
        });
      const tankUp = at(Math.max(9, now.getHours() - 1), 40);
      if (tankUp <= now) {
        add({
          category: SK_CATEGORIES.fuel,
          cents: 5_210,
          on: now,
          merchant: "Slovnaft",
          paidBy: userA.id,
          time: tankUp,
          note: "Полный бак перед поездкой в Žilina",
        });
      }
      const lunch = at(12, 40);
      if (lunch <= now)
        add({
          category: SK_CATEGORIES.restaurants,
          cents: 1_280,
          on: now,
          merchant: "Wolt",
          paidBy: userA.id,
          time: lunch,
          source: "manual",
        });
    }

    const inserted = await db
      .insert(schema.transactions)
      .values(rows)
      .returning({
        id: schema.transactions.id,
        source: schema.transactions.source,
        occurredAt: schema.transactions.occurredAt,
      });
    console.log(`  ${inserted.length} transactions`);

    /* ----------------------------------------------------------- transfers */

    console.log("· transfers");
    const transfer = async (
      from: string,
      to: string,
      cents: number,
      on: Date,
      fromTitle: string,
      toTitle: string,
      by: string,
    ): Promise<void> => {
      const amount = toMinor(cents);
      const base = {
        householdId,
        categoryId: null,
        createdByUserId: by,
        paidByUserId: by,
        type: "transfer" as const,
        currency: BASE_CURRENCY,
        fxRateToBase: ONE_TO_ONE,
        occurredOn: toISODate(on),
        source: "manual" as const,
      };
      const [out] = await db
        .insert(schema.transactions)
        .values({
          ...base,
          accountId: from,
          amountMinor: negateMinor(amount),
          amountBaseMinor: negateMinor(amount),
          merchant: fromTitle,
          merchantSlug: seededSlug(fromTitle),
        })
        .returning();
      const [inc] = await db
        .insert(schema.transactions)
        .values({
          ...base,
          accountId: to,
          amountMinor: amount,
          amountBaseMinor: amount,
          merchant: toTitle,
          merchantSlug: seededSlug(toTitle),
        })
        .returning();
      if (out && inc) {
        await db
          .insert(schema.transferLinks)
          .values({ fromTransactionId: out.id, toTransactionId: inc.id });
      }
    };

    for (let offset = 11; offset >= 1; offset -= 1) {
      const month = startOfMonth(subMonths(now, offset));
      await transfer(
        current.id,
        savings.id,
        between(25, 40) * 1_000,
        addDays(month, 16),
        "Na sporenie",
        "Z bežného účtu",
        userA.id,
      );
    }

    /*
     * Cash and Revolut are only ever topped up from the current account, so
     * each month's ATM withdrawal and Revolut top-up is sized from what was
     * actually spent there (plus the Prague weekend, booked below), rounded up
     * to a round sum the way people withdraw. Neither balance can go negative.
     */
    const pragueMonth = toISODate(monthsAgo(2, 1)).slice(0, 7);
    for (const [accountId, from, to, by] of [
      [cash.id, "Výber z bankomatu", "Výber z bankomatu", userA.id],
      [revolut.id, "Revolut", "Revolut", userB.id],
    ] as const) {
      const spentByMonth = new Map<string, number>();
      for (const row of rows) {
        if (row.accountId !== accountId) continue;
        const key = row.occurredOn.slice(0, 7);
        spentByMonth.set(
          key,
          (spentByMonth.get(key) ?? 0) - Number(row.amountMinor),
        );
      }
      if (accountId === revolut.id) {
        spentByMonth.set(
          pragueMonth,
          (spentByMonth.get(pragueMonth) ?? 0) + 98_704,
        );
      }
      for (const [key, spent] of [...spentByMonth.entries()].sort()) {
        if (spent <= 0) continue;
        const step = accountId === cash.id ? 5_000 : 10_000;
        const amount = Math.ceil((spent + 1_000) / step) * step;
        await transfer(
          current.id,
          accountId,
          amount,
          new Date(`${key}-01T09:00:00`),
          from,
          to,
          by,
        );
      }
    }

    /* ----------------------------------------- a weekend in Prague, in CZK */

    console.log("· a weekend in Prague, paid in CZK");
    {
      const rate = toScaledRate(0.0398);
      const czk = toMinor(-248_000);
      await db.insert(schema.transactions).values({
        householdId,
        accountId: revolut.id,
        categoryId: cat(SK_CATEGORIES.travel),
        createdByUserId: userB.id,
        paidByUserId: userB.id,
        type: "expense",
        amountMinor: czk,
        currency: "CZK",
        fxRateToBase: rate,
        amountBaseMinor: toMinor(-98_704),
        occurredOn: toISODate(monthsAgo(2, 11)),
        merchant: "Víkend v Prahe",
        merchantSlug: seededSlug("Víkend v Prahe"),
        note: "Hotel + večera, 2 noci",
        noteSlug: seededSlug("Hotel + večera, 2 noci"),
        source: "manual",
      });
    }

    /* ------------------------------------------------------------- budgets */

    console.log("· budgets");
    /*
     * Three months of budgets, so the stepper on Бюджеты has history. The
     * current month's restaurant budget is tight on purpose — already over
     * after a few days — and housing is the fixed cost the rent rule pays,
     * which reads «оплачено».
     */
    const limits: readonly [string, number][] = [
      [SK_CATEGORIES.housing, 89_000],
      [SK_CATEGORIES.groceries, 52_000],
      [SK_CATEGORIES.restaurants, 16_000],
      [SK_CATEGORIES.fuel, 12_000],
      [SK_CATEGORIES.utilities, 14_000],
      [SK_CATEGORIES.transport, 6_000],
      [SK_CATEGORIES.entertainment, 6_000],
      [SK_CATEGORIES.drugstore, 5_000],
    ];
    for (const offset of [2, 1, 0]) {
      const periodStart = toISODate(startOfMonth(subMonths(now, offset)));
      await db.insert(schema.budgets).values(
        limits.map(([name, limit]) => ({
          householdId,
          categoryId: cat(name),
          periodStart,
          limitMinor: toMinor(
            offset === 0 && name === SK_CATEGORIES.restaurants ? 6_000 : limit,
          ),
          currency: BASE_CURRENCY,
        })),
      );
    }

    /* --------------------------------------------------------------- goals */

    console.log("· goals");
    const [holiday, buffer, japan] = await db
      .insert(schema.goals)
      .values([
        {
          householdId,
          name: "Holiday",
          slug: seededSlug("Holiday"),
          targetMinor: toMinor(300_000),
          currency: BASE_CURRENCY,
          targetDate: toISODate(startOfMonth(addMonths(now, 9))),
          accountId: savings.id,
        },
        {
          householdId,
          name: "Six-month buffer",
          slug: seededSlug("Six-month buffer"),
          targetMinor: toMinor(900_000),
          currency: BASE_CURRENCY,
          accountId: savings.id,
        },
        {
          householdId,
          name: "Trip to Japan",
          slug: seededSlug("Trip to Japan"),
          targetMinor: toMinor(200_000),
          currency: BASE_CURRENCY,
          accountId: savings.id,
        },
      ])
      .returning();
    if (!holiday || !buffer || !japan)
      throw new Error("failed to create goals");

    const contribute = async (
      goalId: string,
      plan: readonly [number, number][],
    ): Promise<void> => {
      await db.insert(schema.goalContributions).values(
        plan.map(([offset, cents]) => ({
          goalId,
          amountMinor: toMinor(cents),
          occurredOn: toISODate(
            addDays(startOfMonth(subMonths(now, offset)), 16),
          ),
        })),
      );
    };
    await contribute(holiday.id, [
      [6, 20_000],
      [5, 25_000],
      [4, 15_000],
      [3, 20_000],
      [2, 25_000],
      [1, 20_000],
    ]);
    await contribute(buffer.id, [
      [11, 40_000],
      [9, 35_000],
      [7, 40_000],
      [5, 45_000],
      [3, 35_000],
      [1, 35_000],
    ]);
    // Reached in full, then the trip happened: the achieved state.
    await contribute(japan.id, [
      [11, 50_000],
      [10, 50_000],
      [9, 40_000],
      [8, 40_000],
      [7, 20_000],
    ]);

    /* ----------------------------------------------------- Apple Pay status */

    console.log("· Apple Pay webhook");
    const lastTap = inserted
      .filter((row) => row.source === "apple_pay" && row.occurredAt !== null)
      .sort(
        (a, b) =>
          (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0),
      )[0];
    const secret = randomBytes(32).toString("base64url");
    await db.insert(schema.walletWebhooks).values({
      householdId,
      secretHash: createHash("sha256").update(secret, "utf8").digest("hex"),
      secretHint: secretHint(secret),
      rotatedAt: addDays(now, -45),
      lastReceivedAt: lastTap?.occurredAt ?? null,
      lastTransactionId: lastTap?.id ?? null,
    });

    /* --------------------------------------------------------- quick picks */

    await db
      .insert(schema.quickPicks)
      .values(
        [
          SK_CATEGORIES.groceries,
          SK_CATEGORIES.restaurants,
          SK_CATEGORIES.fuel,
          SK_CATEGORIES.transport,
          SK_CATEGORIES.health,
          SK_CATEGORIES.drugstore,
        ].map((name, index) => ({
          householdId,
          categoryId: cat(name),
          sortOrder: index,
        })),
      );

    const total = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.householdId, householdId));

    console.log("\n✅ seed complete");
    console.log(
      `   members   : ${userA.email}, ${userB.email} (passwords and sessions kept)`,
    );
    console.log(
      `   txns      : ${total.length} over 12 months, up to ${today}`,
    );
    console.log(`   Apple Pay : new webhook secret (shown once) — ${secret}`);
  } finally {
    await pool.end();
  }
}

main(url).catch((error: unknown) => {
  console.error("❌ seed failed:", error);
  process.exit(1);
});
