import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { allowedEmailCount, getHousehold, listMembers } from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { HouseholdScreen } from "@/components/more/ios/household-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.more.household");
  return { title: t("title") };
}

/** Семья (boards EL01 / E01), pushed from the household card on Ещё. */
export default async function HouseholdPage() {
  const user = await requireUser();
  const [household, members] = await Promise.all([
    getHousehold(user.householdId),
    listMembers(user.householdId),
  ]);

  return (
    <Screen>
      <HouseholdScreen
        name={household.name}
        baseCurrency={household.baseCurrency}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          avatarEmoji: m.avatarEmoji,
        }))}
        allowedCount={allowedEmailCount()}
      />
    </Screen>
  );
}
