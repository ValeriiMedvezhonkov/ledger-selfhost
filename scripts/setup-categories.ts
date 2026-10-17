import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import en from "../messages/en.json";
import ru from "../messages/ru.json";

config({ path: ".env", quiet: true });

/**
 * Gives a household the standard set of categories.
 *
 * Separate from `db:seed`, which also invents a year of sample transactions —
 * useful for looking at charts, wrong for a real ledger. This writes categories
 * and nothing else.
 *
 * Names are stored per the slug, so what the app shows follows the interface
 * language rather than whatever was inserted. The stored string is only the
 * fallback for a missing message, and is written in English.
 *
 *   npm run db:categories            # show what would be created
 *   npm run db:categories -- --apply # create it
 */
interface CategorySpec {
  readonly slug: string;
  readonly kind: "income" | "expense";
  readonly icon: string;
  readonly color: string;
  readonly system?: boolean;
}

/** Colours are the validated categorical slots from lib/chart-palette.ts. */
const CATALOGUE: readonly CategorySpec[] = [
  { slug: "salary", kind: "income", icon: "Banknote", color: "#008300" },
  { slug: "freelance", kind: "income", icon: "Laptop", color: "#1baf7a" },

  { slug: "groceries", kind: "expense", icon: "ShoppingCart", color: "#eb6834" },
  { slug: "housing", kind: "expense", icon: "House", color: "#2a78d6" },
  { slug: "restaurants", kind: "expense", icon: "UtensilsCrossed", color: "#e34948" },
  { slug: "transport", kind: "expense", icon: "Bus", color: "#1baf7a" },
  { slug: "fuel", kind: "expense", icon: "Fuel", color: "#4a3aa7" },
  { slug: "utilities", kind: "expense", icon: "Zap", color: "#eda100" },
  { slug: "telecom", kind: "expense", icon: "Smartphone", color: "#898781" },
  { slug: "health", kind: "expense", icon: "HeartPulse", color: "#e87ba4" },
  { slug: "drugstore", kind: "expense", icon: "Pill", color: "#e87ba4" },
  { slug: "clothing", kind: "expense", icon: "Shirt", color: "#e34948" },
  { slug: "electronics", kind: "expense", icon: "MonitorSmartphone", color: "#2a78d6" },
  { slug: "home", kind: "expense", icon: "Sofa", color: "#eb6834" },
  { slug: "entertainment", kind: "expense", icon: "Clapperboard", color: "#4a3aa7" },
  { slug: "sport", kind: "expense", icon: "Dumbbell", color: "#1baf7a" },
  { slug: "beauty", kind: "expense", icon: "Sparkles", color: "#e87ba4" },
  { slug: "pets", kind: "expense", icon: "PawPrint", color: "#eda100" },
  { slug: "kids", kind: "expense", icon: "Baby", color: "#e87ba4" },
  { slug: "education", kind: "expense", icon: "GraduationCap", color: "#4a3aa7" },
  { slug: "travel", kind: "expense", icon: "Plane", color: "#eda100" },
  { slug: "insurance", kind: "expense", icon: "ShieldCheck", color: "#898781" },
  { slug: "fees", kind: "expense", icon: "ReceiptText", color: "#898781" },
  { slug: "gifts", kind: "expense", icon: "Gift", color: "#e34948" },

  /*
   * The fallback transactions move to when their category is deleted. Every
   * household needs exactly one; the schema enforces that with a partial unique
   * index, so creating a second would fail rather than corrupt anything.
   */
  { slug: "uncategorised", kind: "expense", icon: "CircleHelp", color: "#898781", system: true },
];

function nameFor(slug: string, locale: "en" | "ru"): string {
  const table: Record<string, string> =
    locale === "ru" ? ru.categories.seeded : en.categories.seeded;
  return table[slug] ?? slug;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...(process.env.DATABASE_URL?.includes("neon.tech") === true
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
  });
  const db = drizzle(pool, { schema });

  const [household] = await db.select().from(schema.households).limit(1);
  if (!household) {
    console.error("No household yet. Create an account first:");
    console.error("  npm run user:password");
    await pool.end();
    process.exit(1);
  }

  const existing = await db
    .select({ slug: schema.categories.slug, name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, household.id));

  const present = new Set(existing.map((row) => row.slug));
  const missing = CATALOGUE.filter((spec) => !present.has(spec.slug));

  console.log(`Household: ${household.name}`);
  console.log(`Already there: ${String(existing.length)}`);
  console.log(`To create:     ${String(missing.length)}\n`);

  if (missing.length > 0) {
    console.log("  RUSSIAN                    ENGLISH                  KIND");
    console.log("  " + "-".repeat(66));
    for (const spec of missing) {
      const suffix = spec.system === true ? "  (fallback)" : "";
      console.log(
        "  " +
          nameFor(spec.slug, "ru").padEnd(26) +
          nameFor(spec.slug, "en").padEnd(24) +
          spec.kind +
          suffix,
      );
    }
    console.log("");
  }

  if (!apply) {
    console.log("Nothing written. Re-run with --apply to create them.");
    await pool.end();
    return;
  }

  if (missing.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  await db.insert(schema.categories).values(
    missing.map((spec) => ({
      householdId: household.id,
      // The slug is what the app renders from; this is the fallback text.
      name: nameFor(spec.slug, "en"),
      slug: spec.slug,
      kind: spec.kind,
      icon: spec.icon,
      color: spec.color,
      isSystem: spec.system === true,
    })),
  );

  console.log(`Created ${String(missing.length)} categories.`);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
