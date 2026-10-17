import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listAccounts } from "@/lib/queries";
import { listImportCategories } from "@/lib/import-queries";
import { Screen } from "@/components/ios/screen";
import { ImportScreen } from "@/components/import/ios/import-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.import");
  return { title: t("title") };
}

/** Импорт выписки (boards EL06 / E06), pushed from Ещё. */
export default async function ImportPage() {
  const user = await requireUser();
  const [accounts, categories] = await Promise.all([
    listAccounts(user.householdId),
    listImportCategories(user.householdId),
  ]);

  return (
    <Screen>
      <ImportScreen
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          isDefault: a.isDefault,
        }))}
        categories={categories}
      />
    </Screen>
  );
}
