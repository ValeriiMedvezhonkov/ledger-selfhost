import type { Metadata } from "next";
import { cookies } from "next/headers";
import { addDays, addMonths, addWeeks, addYears, format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { lastNMonths, monthEndISO, monthStartISO, toISODate, todayISO } from "@/lib/date";
import { getFirstDataDate, getNetWorthSeries, getStatRows } from "@/lib/stats";
import { listAccounts, listBudgets, listCategories, listMembers } from "@/lib/queries";
import { materializeRecurring } from "@/lib/recurring";
import { getFormats } from "@/lib/formats-server";
import { parseStatsChartPrefs, STATS_CHARTS_COOKIE } from "@/lib/stats-charts";
import { parseStatsFilters, shiftStatsPeriod, statsPeriod } from "@/lib/stats-filters";
import { computeStatsInsights, statsWindow } from "@/lib/stats-insights";
import { Screen } from "@/components/ios/screen";
import { StatsScreen } from "@/components/stats/stats-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.stats");
  return { title: t("title") };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Статистика (boards L15–L20), one push from Обзор: how the period is going,
 * where and when the money goes, what is fixed, who spends and what is kept.
 * The URL holds the filters (lib/stats-filters), a cookie the chart order.
 */
export default async function StatsPage(props: PageProps<"/stats">) {
  const user = await requireUser();
  const [t, f, params, jar] = await Promise.all([
    getTranslations("ios.stats"),
    getFormats(),
    props.searchParams,
    cookies(),
  ]);
  const now = serverNow();
  const today = todayISO(now);
  const locale = f.calendar;

  await materializeRecurring(user.householdId, today, user.baseCurrency);

  const [members, accounts, categories] = await Promise.all([
    listMembers(user.householdId),
    listAccounts(user.householdId),
    listCategories(user.householdId),
  ]);

  // Ids from the URL count only if they are this household's.
  const parsed = parseStatsFilters(params, today);
  const filters = {
    ...parsed,
    memberId: members.some((m) => m.id === parsed.memberId) ? parsed.memberId : null,
    accountId: accounts.some((a) => a.id === parsed.accountId) ? parsed.accountId : null,
    categoryIds: parsed.categoryIds.filter((id) => categories.some((c) => c.id === id)),
  };

  const period = statsPeriod(filters.span, filters.at);
  const anchor = period.to < today ? period.to : today;
  const [rows, firstDataOn, budgets, netWorth] = await Promise.all([
    getStatRows(user.householdId, statsWindow(filters, today), filters),
    getFirstDataDate(user.householdId),
    listBudgets(user.householdId, monthStartISO(anchor), monthEndISO(anchor)),
    getNetWorthSeries(user.householdId, lastNMonths(now, 12), user.baseCurrency),
  ]);
  const insights = computeStatsInsights({
    rows,
    filters,
    today,
    budgets: budgets.map((b) => ({ categoryId: b.categoryId, limitMinor: b.limitMinor, isFixed: b.isFixed })),
    firstDataOn,
  });

  /* ------------------------------------------------------------- labels */

  const date = (value: string) => new Date(`${value}T12:00:00`);
  const range = (from: string, to: string) => `${f.dateShort(from)} – ${f.dateShort(to)}`;
  const shortMonth = (value: string) => format(date(value), "LLL", { locale }).replace(".", "");
  const current = statsPeriod(filters.span, today).from === period.from;
  const previous = shiftStatsPeriod(filters.span, filters.at, -1);

  const periodLabel =
    filters.span === "month"
      ? capitalize(format(date(period.from), "LLLL yyyy", { locale }))
      : filters.span === "week"
        ? range(period.from, period.to)
        : period.from.slice(0, 4);
  const chip =
    filters.span === "month" && period.from.slice(0, 4) === today.slice(0, 4)
      ? capitalize(format(date(period.from), "LLLL", { locale }))
      : filters.span === "week" && current
        ? t("chips.thisWeek")
        : periodLabel;

  const periods =
    filters.span === "month"
      ? Array.from({ length: 12 }, (_, i) => {
          const at = toISODate(addMonths(date(monthStartISO(today)), -i));
          return { at, label: capitalize(format(date(at), "LLLL yyyy", { locale })) };
        })
      : filters.span === "week"
        ? Array.from({ length: 8 }, (_, i) => {
            const week = statsPeriod("week", toISODate(addWeeks(date(today), -i)));
            return { at: week.from, label: i === 0 ? t("chips.thisWeek") : range(week.from, week.to) };
          })
        : Array.from({ length: 4 }, (_, i) => {
            const at = toISODate(addYears(date(today), -i));
            return { at: statsPeriod("year", at).from, label: at.slice(0, 4) };
          });

  return (
    <Screen>
      <StatsScreen
        data={{
          today,
          currency: user.baseCurrency,
          filters,
          insights,
          categories: categories.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            icon: c.icon,
            color: c.color,
            kind: c.kind,
          })),
          members: members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
          accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
          budgets,
          netWorth,
          charts: parseStatsChartPrefs(jar.get(STATS_CHARTS_COOKIE)?.value),
          labels: {
            period: periodLabel,
            chip,
            since: format(date(period.from), "d MMMM", { locale }),
            current:
              filters.span === "month"
                ? format(date(period.from), "LLLL", { locale })
                : filters.span === "week"
                  ? current
                    ? t("legend.thisWeek")
                    : periodLabel
                  : periodLabel,
            compare:
              filters.compare === "average"
                ? t("legend.average", { span: filters.span })
                : filters.span === "month"
                  ? format(date(previous.from), "LLLL", { locale })
                  : filters.span === "week"
                    ? t("legend.lastWeek")
                    : previous.from.slice(0, 4),
            compareRef:
              filters.compare === "average"
                ? "avg"
                : filters.span === "month"
                  ? String(Number(previous.from.slice(5, 7)))
                  : filters.span,
            months: insights.months.map(shortMonth),
            // 1 January 2024 was a Monday.
            weekdays: Array.from({ length: 7 }, (_, i) =>
              format(addDays(date("2024-01-01"), i), "EEEEEE", { locale }),
            ),
            yearMonths: Array.from({ length: 12 }, (_, i) =>
              shortMonth(toISODate(addMonths(date("2024-01-01"), i))),
            ),
          },
          periods,
        }}
      />
    </Screen>
  );
}
