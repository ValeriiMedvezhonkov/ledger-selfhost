import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getCategoryNamer } from "@/lib/category-name";

/**
 * A category as the import preview needs it: the *stored* name next to the
 * displayed one.
 *
 * `commitImport` resolves a row's category by comparing the file's category
 * (or the recognised merchant's, e.g. "Potraviny") with the stored name,
 * case-insensitively, across every category including archived ones. The
 * preview has to make the same match to show the tile the row will really
 * get, and `listCategories` only exposes the translated name — which in a
 * Russian interface no longer reads "Potraviny".
 */
export interface ImportCategory {
  readonly id: string;
  /** Lower-cased stored name, the key `commitImport` matches on. */
  readonly matchKey: string;
  readonly name: string;
  readonly slug: string | null;
  readonly icon: string;
  readonly color: string;
}

export async function listImportCategories(
  householdId: string,
): Promise<ImportCategory[]> {
  const nameCategory = await getCategoryNamer();
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      icon: categories.icon,
      color: categories.color,
    })
    .from(categories)
    .where(eq(categories.householdId, householdId));

  return rows.map((row) => ({
    id: row.id,
    matchKey: row.name.toLowerCase(),
    name: nameCategory(row.slug, row.name),
    slug: row.slug,
    icon: row.icon,
    color: row.color,
  }));
}
