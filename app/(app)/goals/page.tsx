import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { todayISO } from "@/lib/date";
import { projectGoal } from "@/lib/goals";
import { listAccounts, listGoals } from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { GoalsScreen, type GoalCard } from "@/components/goals/ios/goals-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.goals");
  return { title: t("title") };
}

/**
 * Цели (boards EL02 / E02), pushed from Ещё. The projection runs here, on the
 * server's one sanctioned clock read, so the card says the same «к июн 2027»
 * on the server render and after hydration.
 */
export default async function GoalsPage() {
  const user = await requireUser();
  const now = serverNow();

  const [goals, accounts] = await Promise.all([
    listGoals(user.householdId),
    listAccounts(user.householdId),
  ]);

  const cards: GoalCard[] = goals.map((goal) => {
    const projection = projectGoal(goal, now);
    return {
      id: goal.id,
      name: goal.name,
      slug: goal.slug,
      currency: goal.currency,
      targetMinor: goal.targetMinor,
      savedMinor: goal.savedMinor,
      targetDate: goal.targetDate,
      accountId: goal.accountId,
      percent: projection.percent,
      remainingMinor: projection.remainingMinor,
      achievedOn: projection.achievedOn,
      projectedOn: projection.projectedOn,
    };
  });

  return (
    <Screen>
      <GoalsScreen
        goals={cards}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        baseCurrency={user.baseCurrency}
        today={todayISO(now)}
      />
    </Screen>
  );
}
