import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { listAccounts } from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { AccountsScreen } from "@/components/accounts/ios/accounts-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.accounts");
  return { title: t("title") };
}

/** Счета (boards EL03 / E03), pushed from Ещё: active accounts, then the archive. */
export default async function AccountsPage() {
  const user = await requireUser();
  const accounts = await listAccounts(user.householdId, { includeArchived: true });

  return (
    <Screen>
      <AccountsScreen
        accounts={accounts}
        baseCurrency={user.baseCurrency}
        // «Закрыт в мае» only names the year when it isn't this one.
        currentYear={serverNow().getFullYear()}
      />
    </Screen>
  );
}
