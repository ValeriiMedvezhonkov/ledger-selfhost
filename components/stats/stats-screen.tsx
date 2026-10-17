"use client";

import { useLayoutEffect, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassGroup } from "@/components/ios/glass";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import {
  STATS_CHARTS_COOKIE,
  serializeStatsChartPrefs,
  type StatsChart,
  type StatsChartPrefs,
} from "@/lib/stats-charts";
import { statsPeriod, statsQuery, type StatsFilters } from "@/lib/stats-filters";
import {
  BudgetsSection,
  CategoriesSection,
  FixedSection,
  MembersSection,
  MerchantsSection,
  NetWorthSection,
  PaceSection,
  SavingsSection,
  WhenSection,
} from "@/components/stats/sections";
import { StatsFiltersSheet } from "@/components/stats/filters-sheet";
import { StatsChartsSheet } from "@/components/stats/charts-sheet";
import type { StatsData } from "@/components/stats/types";
import { cn } from "@/lib/utils";

const SECTIONS: Readonly<Record<StatsChart, (props: { readonly data: StatsData }) => ReactNode>> = {
  pace: PaceSection,
  categories: CategoriesSection,
  merchants: MerchantsSection,
  when: WhenSection,
  fixed: FixedSection,
  members: MembersSection,
  savings: SavingsSection,
  budgets: BudgetsSection,
  networth: NetWorthSection,
};

/** A filter chip that a menu can open (GlassChip does not pass props on). */
function Chip({
  active = false,
  children,
  ...props
}: ComponentProps<"button"> & { readonly active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "glass press flex h-[38px] shrink-0 items-center gap-1 rounded-full pr-3 pl-3.5 text-[15px] tracking-[-0.013em]",
        active ? "glass-tinted font-semibold" : "font-medium",
      )}
    >
      {children}
      <Symbol
        name="keyboard_arrow_down"
        size={18}
        weight={600}
        className={active ? "text-white" : "text-label-2"}
      />
    </button>
  );
}

/**
 * Статистика (boards L15–L20): pushed from Обзор. Filter chips under the
 * title, the charts in the owner's order, and two sheets — Фильтры for every
 * way to slice the numbers, Графики for what is shown.
 */
export function StatsScreen({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filtering, setFiltering] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [prefs, setPrefs] = useState<StatsChartPrefs>(data.charts);
  const { filters, insights, labels } = data;

  const go = (next: StatsFilters) => {
    const query = statsQuery(next, data.today);
    startTransition(() => {
      router.replace(query === "" ? "/stats" : `/stats?${query}`, { scroll: false });
    });
  };

  const arrange = (next: StatsChartPrefs) => {
    setPrefs(next);
    // A cookie, so the server lays the screen out the same way next time.
    document.cookie = `${STATS_CHARTS_COOKIE}=${encodeURIComponent(serializeStatsChartPrefs(next))}; path=/; max-age=31536000; samesite=lax`;
  };

  // Обзор's tiles link to a section («/stats#categories»): start there.
  useLayoutEffect(() => {
    const id = window.location.hash.slice(1);
    if (id !== "") document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  const pickedCategories = data.categories.filter((c) => filters.categoryIds.includes(c.id));
  const kindCategories = data.categories.filter((c) => filters.kind === "all" || c.kind === filters.kind);
  const member = data.members.find((m) => m.id === filters.memberId);
  const account = data.accounts.find((a) => a.id === filters.accountId);
  const sheetOnly =
    (filters.kind !== "expense" ? 1 : 0) +
    (filters.withoutFixed ? 1 : 0) +
    (filters.compare !== "previous" ? 1 : 0);

  const visible = prefs.order.filter(
    (id) =>
      !prefs.hidden.includes(id) &&
      // One person's view has no one to compare them with.
      !(id === "members" && (filters.memberId !== null || data.members.length < 2)),
  );

  return (
    <>
      <NavBar
        large
        largeBelow
        title={t("title")}
        subtitle={
          insights.inProgress
            ? `${labels.period} · ${t("elapsed", { elapsed: insights.elapsedDays, total: insights.totalDays })}`
            : labels.period
        }
        inlineSubtitle={labels.period}
        back={{ href: "/", label: t("back") }}
        trailing={
          <GlassGroup
            items={[
              {
                icon: "filter_list",
                label: t("filters.title"),
                onClick: () => {
                  setFiltering(true);
                },
              },
              {
                icon: "dashboard_customize",
                label: t("charts.title"),
                onClick: () => {
                  setArranging(true);
                },
              },
            ]}
          />
        }
      />

      <ScreenBody className="gap-[22px] pt-3">
        <div className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
          <GlassMenu
            label={t("filters.period")}
            align="start"
            trigger={<Chip active>{labels.chip}</Chip>}
            entries={data.periods.map((period) => ({
              key: period.at,
              label: period.label,
              checked: statsPeriod(filters.span, period.at).from === insights.period.from,
              onSelect: () => {
                go({ ...filters, at: period.at });
              },
            }))}
          />
          <GlassMenu
            label={t("filters.categories")}
            align="start"
            trigger={
              <Chip active={pickedCategories.length > 0}>
                {pickedCategories.length === 0
                  ? t("chips.category")
                  : pickedCategories.length === 1
                    ? pickedCategories[0]?.name
                    : t("filters.categoriesCount", { count: pickedCategories.length })}
              </Chip>
            }
            entries={[
              {
                key: "all",
                label: t("chips.allCategories"),
                checked: pickedCategories.length === 0,
                onSelect: () => {
                  go({ ...filters, categoryIds: [] });
                },
              },
              ...kindCategories.map((category) => ({
                key: category.id,
                label: category.name,
                checked: filters.categoryIds.length === 1 && filters.categoryIds[0] === category.id,
                onSelect: () => {
                  go({ ...filters, categoryIds: [category.id] });
                },
              })),
              "separator" as const,
              {
                key: "several",
                label: t("chips.several"),
                icon: "filter_list" as const,
                onSelect: () => {
                  setFiltering(true);
                },
              },
            ]}
          />
          {data.members.length > 1 && (
            <GlassMenu
              label={t("filters.who")}
              align="start"
              trigger={<Chip active={member !== undefined}>{member?.name ?? t("chips.who")}</Chip>}
              entries={[
                {
                  key: "all",
                  label: t("filters.both"),
                  checked: member === undefined,
                  onSelect: () => {
                    go({ ...filters, memberId: null });
                  },
                },
                ...data.members.map((m) => ({
                  key: m.id,
                  label: m.name,
                  checked: m.id === filters.memberId,
                  onSelect: () => {
                    go({ ...filters, memberId: m.id });
                  },
                })),
              ]}
            />
          )}
          <GlassMenu
            label={t("filters.account")}
            align="start"
            trigger={<Chip active={account !== undefined}>{account?.name ?? t("chips.account")}</Chip>}
            entries={[
              {
                key: "all",
                label: t("filters.allAccounts"),
                checked: account === undefined,
                onSelect: () => {
                  go({ ...filters, accountId: null });
                },
              },
              ...data.accounts.map((a) => ({
                key: a.id,
                label: a.name,
                checked: a.id === filters.accountId,
                onSelect: () => {
                  go({ ...filters, accountId: a.id });
                },
              })),
            ]}
          />
          {sheetOnly > 0 && (
            <Chip
              active
              onClick={() => {
                setFiltering(true);
              }}
            >
              {t("chips.more", { count: sheetOnly })}
            </Chip>
          )}
        </div>

        <div className={cn("flex flex-col gap-[22px] transition-opacity", pending && "opacity-60")}>
          {visible.map((id) => {
            const Section = SECTIONS[id];
            return <Section key={id} data={data} />;
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setArranging(true);
          }}
          className="inset-group press-row t-body text-tint flex h-[52px] w-full items-center justify-center gap-2 font-medium"
        >
          <Symbol name="dashboard_customize" size={22} />
          {t("charts.customize")}
        </button>
      </ScreenBody>

      <StatsFiltersSheet
        open={filtering}
        onOpenChange={setFiltering}
        filters={filters}
        today={data.today}
        categories={data.categories}
        members={data.members}
        accounts={data.accounts}
        apply={go}
      />
      <StatsChartsSheet open={arranging} onOpenChange={setArranging} prefs={prefs} onChange={arrange} />
    </>
  );
}
