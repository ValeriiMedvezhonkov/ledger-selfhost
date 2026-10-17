import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { CategoriesScreen } from "@/components/categories/ios/categories-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.categories");
  return { title: t("title") };
}

/** Категории (boards EL04 / E04), pushed from Ещё. */
export default async function CategoriesPage() {
  const user = await requireUser();
  const categories = await listCategories(user.householdId);

  return (
    <Screen>
      <CategoriesScreen
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          kind: c.kind,
          icon: c.icon,
          color: c.color,
          parentId: c.parentId,
          isSystem: c.isSystem,
          transactionCount: c.transactionCount,
        }))}
      />
    </Screen>
  );
}
