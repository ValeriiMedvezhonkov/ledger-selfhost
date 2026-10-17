import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { todayISO } from "@/lib/date";
import { listAccounts, listCategories, listMembers, listRecurring } from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { RecurringScreen } from "@/components/recurring/ios/recurring-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.recurring");
  return { title: t("title") };
}

/** Регулярные (boards EL05 / E05), pushed from Ещё. */
export default async function RecurringPage() {
  const user = await requireUser();
  const [rules, accounts, categories, members] = await Promise.all([
    listRecurring(user.householdId),
    listAccounts(user.householdId),
    listCategories(user.householdId),
    listMembers(user.householdId),
  ]);

  return (
    <Screen>
      <RecurringScreen
        rules={rules}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          isDefault: a.isDefault,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          color: c.color,
          kind: c.kind,
        }))}
        members={members.map((m) => ({ id: m.id, name: m.name, color: m.color }))}
        currentUserId={user.id}
        baseCurrency={user.baseCurrency}
        today={todayISO(serverNow())}
      />
    </Screen>
  );
}
