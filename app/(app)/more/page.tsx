import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { getHousehold, listMembers } from "@/lib/queries";
import { getMoreCounts } from "@/lib/more-queries";
import { getWalletStatus } from "@/lib/wallet";
import { getAppLockState } from "@/lib/app-lock";
import { Screen } from "@/components/ios/screen";
import { MoreScreen } from "@/components/more/ios/more-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.more");
  return { title: t("title") };
}

/** Ещё (boards L09 / D09) — the tab root for everything that is not a list of money. */
export default async function MorePage() {
  const user = await requireUser();
  const [household, members, counts, wallet, lock] = await Promise.all([
    getHousehold(user.householdId),
    listMembers(user.householdId),
    getMoreCounts(user.householdId),
    getWalletStatus(user.householdId),
    getAppLockState(),
  ]);

  return (
    <Screen>
      <MoreScreen
        householdName={household.name}
        baseCurrency={household.baseCurrency}
        members={members.map((m) => ({ id: m.id, name: m.name, color: m.color }))}
        counts={counts}
        walletConfigured={wallet.configured}
        appLockEnabled={lock.enabled}
      />
    </Screen>
  );
}
