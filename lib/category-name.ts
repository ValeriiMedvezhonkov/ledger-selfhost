import "server-only";
import { getTranslations } from "next-intl/server";

/**
 * Resolves a category's display name against the interface language.
 *
 * Categories are rows, not message keys, so the name cannot simply be looked
 * up: a household can create its own, and there is no translation for a name
 * someone typed. Only the ones the app ships carry a `slug`, and only those get
 * translated — everything else renders exactly as stored.
 *
 * `t.has` guards the lookup because a slug can outlive its message: a category
 * seeded by an older version, or one whose key was renamed, would otherwise
 * throw at render instead of quietly falling back to the stored name.
 */
export type CategoryNamer = (
  slug: string | null,
  name: string,
) => string;

export async function getCategoryNamer(): Promise<CategoryNamer> {
  const t = await getTranslations("categories.seeded");

  return (slug, name) => {
    if (slug === null) return name;
    return t.has(slug) ? t(slug) : name;
  };
}
