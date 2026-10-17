import "server-only";
import { getTranslations } from "next-intl/server";

/**
 * Resolves the name of a row the app itself created against the interface
 * language.
 *
 * The seed writes starter accounts, goals, rules and sample notes. Those are
 * the app's words, so they should read in the reader's language — but they live
 * in the same columns as everything a household types itself, which must not be
 * touched. A `slug` is what separates the two: set by the seed, null everywhere
 * else, and cleared the moment someone edits the value.
 *
 * `t.has` guards a slug that outlived its message, so a stale row degrades to
 * the stored text rather than throwing.
 */
export type SeededNamer = (slug: string | null, value: string) => string;

export async function getSeededNamer(): Promise<SeededNamer> {
  const t = await getTranslations("seeded");

  return (slug, value) => {
    if (slug === null) return value;
    return t.has(slug) ? t(slug) : value;
  };
}

/**
 * The slug to persist after an edit: kept if the value is untouched, dropped if
 * it changed.
 *
 * The comparison is against the *translated* value, because that is what the
 * form was populated with and therefore what it submits back. Comparing against
 * the stored text would read every untouched save as a rename and freeze the
 * row in whichever language it happened to be viewed in.
 */
export async function slugAfterEdit(
  slug: string | null,
  stored: string | null,
  submitted: string | null,
): Promise<string | null> {
  if (slug === null || stored === null) return null;
  const namer = await getSeededNamer();
  return submitted === namer(slug, stored) ? slug : null;
}

/** The nullable-value form, for optional notes. */
export function nameOrNull(
  namer: SeededNamer,
  slug: string | null,
  value: string | null,
): string | null {
  return value === null ? null : namer(slug, value);
}
