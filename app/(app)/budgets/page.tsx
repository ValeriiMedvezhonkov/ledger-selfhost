import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { listBudgets, listCategories } from "@/lib/queries";
import {
  addMonthsISO,
  daysRemainingInMonth,
  monthEndISO,
  monthStartISO,
  todayISO,
  type ISODate,
} from "@/lib/date";
import { Screen } from "@/components/ios/screen";
import { BudgetsScreen } from "@/components/budgets/ios/budgets-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.budgets");
  return { title: t("title") };
}

/** Бюджеты (boards L08 / D08). `?month=YYYY-MM` steps through months. */
export default async function BudgetsPage(props: PageProps<"/budgets">) {
  const user = await requireUser();
  const params = await props.searchParams;
  const today = todayISO(serverNow());
  const raw = Array.isArray(params.month) ? params.month[0] : params.month;
  const periodStart =
    raw !== undefined && /^\d{4}-\d{2}$/.test(raw) ? (`${raw}-01` as ISODate) : monthStartISO(today);
  const periodEnd = monthEndISO(periodStart);
  const current = periodStart === monthStartISO(today);

  const [budgets, categories, previous] = await Promise.all([
    listBudgets(user.householdId, periodStart, periodEnd),
    listCategories(user.householdId),
    listBudgets(user.householdId, addMonthsISO(periodStart, -1), monthEndISO(addMonthsISO(periodStart, -1))),
  ]);

  return (
    <Screen>
      <BudgetsScreen
        budgets={budgets}
        periodStart={periodStart}
        isFuture={periodStart > monthStartISO(today)}
        daysLeft={current ? daysRemainingInMonth(today) : null}
        canCopyPrevious={previous.length > 0}
        currency={user.baseCurrency}
        categories={categories
          .filter((c) => c.kind === "expense")
          .map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, color: c.color, kind: c.kind }))}
      />
    </Screen>
  );
}
