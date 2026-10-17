import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import {
  currentMonthRange,
  daysElapsedInMonth,
  monthEndISO,
  previousMonthRange,
  monthStartISO,
  todayISO,
} from "@/lib/date";
import {
  getFirstDataDate,
  getPeriodTotals,
  getStatRows,
  getTotalBalance,
} from "@/lib/stats";
import { defaultStatsFilters } from "@/lib/stats-filters";
import { computeStatsInsights, statsWindow } from "@/lib/stats-insights";
import { parseStatsChartPrefs, STATS_CHARTS_COOKIE } from "@/lib/stats-charts";
import {
  getHousehold,
  listBudgets,
  listMembers,
  listTransactions,
} from "@/lib/queries";
import { materializeRecurring } from "@/lib/recurring";
import { getFormats } from "@/lib/formats-server";
import { parsePeriod } from "@/lib/periods";
import { categorySymbol, type SymbolName } from "@/lib/symbols";
import { negateMinor, type Minor } from "@/lib/money";
import { Screen, ScreenBody } from "@/components/ios/screen";
import { SectionHeader, SymbolTile } from "@/components/ios/list";
import { Bar, Ring } from "@/components/ios/controls";
import { Symbol } from "@/components/ios/symbol";
import { minus } from "@/lib/typography";
import { HomeToolbar } from "@/components/home/home-toolbar";
import { MemberFilter } from "@/components/home/member-filter";
import { RecentList } from "@/components/home/recent-list";
import { PaceLines } from "@/components/stats/charts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.home");
  return { title: t("title") };
}

/**
 * Обзор (boards L01 / L02, D01 / D02). Hero «Можно тратить», four KPI tiles,
 * the three budgets closest to their limit and the latest entries — the
 * charts moved to /stats, one tap away from any tile.
 */
export default async function HomePage(props: PageProps<"/">) {
  const user = await requireUser();
  const [t, ts, f, params, jar] = await Promise.all([
    getTranslations("ios.home"),
    getTranslations("ios.stats"),
    getFormats(),
    props.searchParams,
    cookies(),
  ]);

  const now = serverNow();
  const today = todayISO(now);
  const members = await listMembers(user.householdId);
  const rawMember = Array.isArray(params.member)
    ? params.member[0]
    : params.member;
  const memberId = members.some((m) => m.id === rawMember)
    ? rawMember
    : undefined;
  const period = parsePeriod(params, now);

  // Due recurring rules become real transactions before anything is measured.
  await materializeRecurring(user.householdId, today, user.baseCurrency);

  const thisMonth = currentMonthRange(now);
  const statsFilters = { ...defaultStatsFilters(today), memberId: memberId ?? null };
  const [
    household,
    balance,
    current,
    previous,
    monthTotals,
    budgets,
    recent,
    statRows,
    firstDataOn,
  ] = await Promise.all([
      getHousehold(user.householdId),
      getTotalBalance(user.householdId, user.baseCurrency),
      getPeriodTotals(user.householdId, period.range, memberId),
      getPeriodTotals(user.householdId, period.previous, memberId),
      getPeriodTotals(user.householdId, thisMonth, memberId),
      listBudgets(user.householdId, monthStartISO(today), monthEndISO(today)),
      listTransactions(user.householdId, {
        page: 1,
        sort: "date-desc",
        categoryIds: [],
        ...(memberId === undefined ? {} : { paidByUserId: memberId }),
      }),
      getStatRows(user.householdId, statsWindow(statsFilters, today), statsFilters),
      getFirstDataDate(user.householdId),
    ]);

  /*
   * What is still available this month. Budgets are the honest source when
   * they exist — a deliberate ceiling; without them it is what came in minus
   * what went out. Per remaining day, so it answers "what can I spend
   * tomorrow", and the ring shows the share of that pot still untouched.
   */
  const budgetLimit = budgets.reduce((sum, b) => sum + b.limitMinor, 0);
  const budgetSpent = budgets.reduce((sum, b) => sum + b.spentMinor, 0);
  const fromBudgets = budgets.length > 0 && memberId === undefined;
  const remaining = (
    fromBudgets ? budgetLimit - budgetSpent : monthTotals.netMinor
  ) as Minor;
  const pot = fromBudgets ? budgetLimit : monthTotals.incomeMinor;
  const daysElapsed = daysElapsedInMonth(today);
  const daysInMonth = Number(monthEndISO(today).slice(8));
  const daysLeft = Math.max(1, daysInMonth - daysElapsed + 1);
  const perDay = (
    remaining > 0 ? Math.round(remaining / daysLeft) : 0
  ) as Minor;
  const remainingShare = pot > 0 ? Math.max(0, remaining) / pot : 0;

  // date-fns' standalone month ("LLLL"): «Октябрь 2026», without the «г.»
  // Intl appends in Russian.
  const monthName = format(now, "LLLL yyyy", { locale: f.calendar });
  const monthTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const periodLabel =
    period.key === "month"
      ? monthTitle
      : period.key === "custom"
        ? `${f.dateShort(period.range.from)} – ${f.dateShort(period.range.to)}`
        : t(`periods.${period.key}`);

  const change =
    previous.incomeMinor > 0
      ? Math.round(
          ((current.incomeMinor - previous.incomeMinor) /
            previous.incomeMinor) *
            100,
        )
      : null;
  // «к сентябрю» needs the dative, which Intl does not produce — the
  // catalogue selects the month's form by number instead.
  const previousMonth =
    period.key === "month" || period.key === "last"
      ? String(Number(period.previous.from.slice(5, 7)))
      : "period";

  const money = (minor: Minor, signed = false) =>
    minus(f.money(minor, user.baseCurrency, { signed }));

  const percentLeft = `${Math.round(remainingShare * 100)}%`;

  const kpis: {
    key: string;
    label: string;
    value: string;
    caption: string;
    icon: SymbolName;
    color: string;
    good?: boolean;
  }[] = [
    {
      key: "balance",
      label: t("kpi.balance"),
      value: money(balance),
      caption: t("kpi.balanceCaption"),
      icon: "account_balance_wallet",
      color: "var(--ios-blue)",
    },
    {
      key: "income",
      label: t("kpi.income"),
      value: money(current.incomeMinor),
      caption:
        change === null
          ? t("kpi.noComparison")
          : t("kpi.vsPrevious", {
              percent: `${change > 0 ? "+" : ""}${change}`,
              month: previousMonth,
            }),
      icon: "south_west",
      color: "var(--ios-green)",
      good: change !== null && change >= 0,
    },
    {
      key: "expense",
      label: t("kpi.expense"),
      value: money(current.expenseMinor),
      caption:
        period.key === "month"
          ? t("kpi.forDays", { count: daysElapsed })
          : periodLabel,
      icon: "north_east",
      color: "var(--ios-red)",
    },
    {
      key: "net",
      label: t("kpi.net"),
      value: money(current.netMinor, true),
      caption: current.netMinor >= 0 ? t("kpi.inPlus") : t("kpi.inMinus"),
      icon: "savings",
      color: "var(--ios-tint)",
    },
  ];

  /*
   * The way into Статистика (board L21): this month against last month by
   * the same day, and where it ends at this pace. One person's view leaves
   * the household's budgets out.
   */
  const pace = computeStatsInsights({
    rows: statRows,
    filters: statsFilters,
    today,
    budgets:
      memberId === undefined
        ? budgets.map((b) => ({
            categoryId: b.categoryId,
            limitMinor: b.limitMinor,
            isFixed: b.isFixed,
          }))
        : [],
    firstDataOn,
  });
  const paceChange = pace.summary.change;
  const statsHref = (section?: string) =>
    `/stats${memberId === undefined ? "" : `?who=${memberId}`}${section === undefined ? "" : `#${section}`}`;
  const charts = parseStatsChartPrefs(jar.get(STATS_CHARTS_COOKIE)?.value);
  const sectionFor: Record<string, string> = {
    // Чистые активы is off by default; savings is the next best answer.
    balance: charts.hidden.includes("networth") ? "savings" : "networth",
    income: "savings",
    expense: "categories",
    net: "savings",
  };

  const topBudgets = [...budgets]
    .sort(
      (a, b) =>
        b.spentMinor / Math.max(1, b.limitMinor) -
        a.spentMinor / Math.max(1, a.limitMinor),
    )
    .slice(0, 3);

  return (
    <Screen>
      <HomeToolbar
        title={t("title")}
        subtitle={`${periodLabel} · ${household.name}`}
        inlineSubtitle={periodLabel}
        period={period.key}
        monthRangeLabel={`${f.dateShort(thisMonth.from)} – ${f.dateShort(thisMonth.to)}`}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
        }))}
      />

      <ScreenBody className="gap-4 pt-3">
        <MemberFilter
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          current={memberId}
        />

        {/* Hero: Можно тратить в день */}
        <section className="inset-group flex items-center gap-4 p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="t-subhead text-label-2">{t("safeLabel")}</p>
            <p className="money text-[40px] leading-[46px] font-bold tracking-[-0.03em]">
              {money(perDay)}
            </p>
            <p className="t-footnote text-label-2">
              {remaining >= 0
                ? t("safeCaption", {
                    amount: money(remaining),
                    count: daysLeft,
                  })
                : t("overCaption", { amount: money(negateMinor(remaining)) })}
            </p>
          </div>
          <Ring
            value={remainingShare}
            size={76}
            stroke={8.5}
            color={remaining >= 0 ? "var(--ios-tint)" : "var(--ios-red)"}
            track="var(--ios-tint-soft)"
          >
            <span className="flex flex-col items-center leading-none">
              <span className="text-[15px] font-bold tracking-[-0.02em]">
                {percentLeft}
              </span>
              <span className="text-label-2 mt-0.5 text-[10px]">
                {t("left")}
              </span>
            </span>
          </Ring>
        </section>

        {/* KPI 2×2 */}
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((kpi) => (
            <Link
              key={kpi.key}
              href={statsHref(sectionFor[kpi.key])}
              transitionTypes={["ios-push"]}
              className="bg-ios-card press flex flex-col gap-2.5 rounded-[22px] p-4"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="grid size-[26px] place-items-center rounded-full text-white"
                  style={{ backgroundColor: kpi.color }}
                >
                  <Symbol name={kpi.icon} size={16} weight={600} />
                </span>
                <span className="t-subhead text-label-2 font-semibold">
                  {kpi.label}
                </span>
              </span>
              <span className="flex flex-col gap-px">
                <span className="money text-[22px] leading-7 font-bold tracking-[-0.027em]">
                  {kpi.value}
                </span>
                <span
                  className={
                    kpi.good === true
                      ? "t-footnote text-ios-green"
                      : "t-footnote text-label-2"
                  }
                >
                  {kpi.caption}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* Статистика */}
        <Link
          href={statsHref()}
          transitionTypes={["ios-push"]}
          className="bg-ios-card press flex flex-col gap-2.5 rounded-[22px] p-4"
        >
          <span className="flex items-center gap-1.5">
            <span className="bg-tint grid size-[26px] place-items-center rounded-full text-white">
              <Symbol name="query_stats" size={16} weight={600} />
            </span>
            <span className="t-subhead text-label-2 flex-1 font-semibold">
              {ts("title")}
            </span>
            <Symbol
              name="chevron_right"
              size={20}
              weight={600}
              className="text-label-3"
            />
          </span>
          <span className="flex items-end gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              {paceChange === null ? (
                <span className="t-subhead text-label-2">{ts("entry.empty")}</span>
              ) : (
                <span className="flex items-baseline gap-1.5">
                  <span
                    className={
                      paceChange > 0.005
                        ? "text-ios-red text-[22px] leading-7 font-bold tracking-[-0.027em]"
                        : "text-ios-green text-[22px] leading-7 font-bold tracking-[-0.027em]"
                    }
                  >
                    {minus(
                      new Intl.NumberFormat(f.calendar.code, {
                        style: "percent",
                        maximumFractionDigits: 0,
                        signDisplay: "exceptZero",
                      }).format(paceChange),
                    )}
                  </span>
                  <span className="t-subhead text-label-2 truncate">
                    {ts("pace.vsWhole", {
                      ref: String(Number(previousMonthRange(now).from.slice(5, 7))),
                    })}
                  </span>
                </span>
              )}
              {pace.summary.projectionMinor !== null && (
                <span
                  className={
                    pace.summary.budgetMinor !== null &&
                    pace.summary.projectionMinor > pace.summary.budgetMinor
                      ? "t-footnote text-ios-red truncate"
                      : "t-footnote text-label-2 truncate"
                  }
                >
                  {pace.summary.budgetMinor === null
                    ? ts("entry.forecast", {
                        amount: f.money(pace.summary.projectionMinor, user.baseCurrency, {
                          noDecimals: true,
                        }),
                      })
                    : ts("entry.forecastOf", {
                        amount: f.money(pace.summary.projectionMinor, user.baseCurrency, {
                          noDecimals: true,
                        }),
                        budget: f.money(pace.summary.budgetMinor, user.baseCurrency, {
                          noDecimals: true,
                        }),
                      })}
                </span>
              )}
            </span>
            <PaceLines
              width={116}
              height={40}
              current={pace.summary.current}
              compare={pace.summary.compare}
              totalDays={pace.totalDays}
              strokeWidth={2.5}
            />
          </span>
        </Link>

        {/* Budgets */}
        <div className="mt-2 flex flex-col gap-2">
          {/*
           * These lead to other tabs (Обзор is the first, so always to the
           * right): they slide like the tab bar's own switch.
           */}
          <SectionHeader
            title={t("budgets")}
            action={{
              label: t("all"),
              href: "/budgets",
              transitionTypes: ["ios-tab-forward"],
            }}
          />
          {topBudgets.length === 0 ? (
            <Link
              href="/budgets"
              transitionTypes={["ios-tab-forward"]}
              className="inset-group t-body text-tint p-4 text-center"
            >
              {t("budgetsEmpty")}
            </Link>
          ) : (
            <div className="inset-group">
              {topBudgets.map((budget) => {
                const share =
                  budget.spentMinor / Math.max(1, budget.limitMinor);
                return (
                  <div
                    key={budget.id}
                    className="flex items-center gap-3.5 pl-4"
                  >
                    <SymbolTile
                      icon={categorySymbol(
                        budget.categoryIcon,
                        budget.categorySlug,
                      )}
                      color={budget.categoryColor}
                    />
                    <div className="row-sep flex min-w-0 flex-1 flex-col gap-[7px] py-[13px] pr-4">
                      <div className="flex items-center gap-2">
                        <span className="t-body min-w-0 flex-1 truncate">
                          {budget.categoryName}
                        </span>
                        <span className="t-subhead text-label-2 money shrink-0">
                          {t("budgetOf", {
                            spent: f.money(
                              budget.spentMinor,
                              user.baseCurrency,
                              { bare: true, noDecimals: true },
                            ),
                            limit: f.money(
                              budget.limitMinor,
                              user.baseCurrency,
                              { noDecimals: true },
                            ),
                          })}
                        </span>
                      </div>
                      <Bar
                        value={share}
                        color={
                          share > 1
                            ? "var(--ios-red)"
                            : share > 0.6
                              ? "var(--ios-orange)"
                              : budget.categoryColor
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent */}
        <div className="mt-2 flex flex-col gap-2">
          <SectionHeader
            title={t("recent")}
            action={{
              label: t("all"),
              href: "/transactions",
              transitionTypes: ["ios-tab-forward"],
            }}
          />
          <RecentList
            rows={recent.items.slice(0, 4)}
            today={today}
            emptyLabel={t("recentEmpty")}
          />
        </div>
      </ScreenBody>
    </Screen>
  );
}
