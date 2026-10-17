"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFormats } from "@/hooks/use-formats";
import { formatLocaleFor } from "@/lib/formats";
import type { Minor } from "@/lib/money";
import { categorySymbol } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { negateMinor } from "@/lib/money";
import type { StatsChart } from "@/lib/stats-charts";
import { MemberAvatar, Ring } from "@/components/ios/controls";
import { SectionHeader, SymbolTile } from "@/components/ios/list";
import { Symbol } from "@/components/ios/symbol";
import { LegendDot, PaceLines, StackedColumns, useWidth } from "@/components/stats/charts";
import type { StatsCategory, StatsData } from "@/components/stats/types";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- shared */

export function useStatsFormat(currency: string) {
  const f = useFormats();
  const { intl } = formatLocaleFor(useLocale());
  const money = (value: number, options: { readonly noDecimals?: boolean; readonly signed?: boolean } = {}) =>
    minus(f.money(Math.round(value) as Minor, currency, options));
  const percent = (ratio: number, signed = false) =>
    minus(
      new Intl.NumberFormat(intl, {
        style: "percent",
        maximumFractionDigits: 0,
        signDisplay: signed ? "exceptZero" : "auto",
      }).format(ratio),
    );
  return { money, percent };
}

/** A section: the 20pt heading, then its card. The id is where Обзор's tiles land. */
function Section({
  id,
  title,
  action,
  note,
  children,
}: {
  readonly id: StatsChart;
  readonly title: string;
  readonly action?: { readonly label: string; readonly href?: string; readonly onClick?: () => void; readonly transitionTypes?: string[] };
  /** A quiet trailing label instead of an action («6 мес.»). */
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-[calc(var(--safe-top)+66px)] flex-col gap-2">
      {note !== undefined ? (
        <div className="flex items-end gap-2 px-4">
          <h2 className="t-title3 min-w-0 flex-1 truncate">{title}</h2>
          <span className="t-body text-label-2">{note}</span>
        </div>
      ) : (
        <SectionHeader title={title} action={action} />
      )}
      {children}
    </section>
  );
}

function categoryOf(categories: readonly StatsCategory[], id: string | null) {
  return categories.find((category) => category.id === id);
}

/** «↓ 8 %» in green when it went the good way for this kind of money. */
function Change({
  change,
  goodWhenUp,
  same,
}: {
  readonly change: number | null;
  readonly goodWhenUp: boolean;
  readonly same: string;
}) {
  const { percent } = useStatsFormat("EUR");
  if (change === null) return null;
  if (Math.abs(change) < 0.005) {
    return <span className="t-footnote text-label-3 font-semibold">{same}</span>;
  }
  const good = change > 0 === goodWhenUp;
  return (
    <span className={cn("t-footnote flex items-center font-semibold", good ? "text-ios-green" : "text-ios-red")}>
      <Symbol name={change > 0 ? "arrow_upward" : "arrow_downward"} size={14} weight={700} />
      {percent(Math.abs(change))}
    </span>
  );
}

/* ------------------------------------------------------------------ pace */

export function PaceSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money, percent } = useStatsFormat(data.currency);
  const { summary, inProgress, totalDays } = data.insights;
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const kind = data.filters.kind;
  const goodWhenUp = kind === "income";
  const change = summary.change;

  return (
    <section id="pace" className="inset-group flex scroll-mt-[calc(var(--safe-top)+66px)] flex-col gap-4 p-[18px]">
      <div className="flex flex-col gap-0.5">
        <p className="t-subhead text-label-2">
          {inProgress
            ? t("pace.since", { kind, date: data.labels.since })
            : t("pace.in", { kind, period: data.labels.period })}
        </p>
        <p className="flex items-end gap-2.5">
          <span className="money text-[34px] leading-[41px] font-bold tracking-[-0.03em]">
            {money(summary.totalMinor)}
          </span>
          {change !== null && (
            <span
              className={cn(
                "pb-1 text-[17px] font-semibold",
                Math.abs(change) < 0.005
                  ? "text-label-2"
                  : change > 0 === goodWhenUp
                    ? "text-ios-green"
                    : "text-ios-red",
              )}
            >
              {percent(change, true)}
            </span>
          )}
        </p>
        <p className="t-footnote text-label-2">
          {change === null
            ? t("pace.noCompare")
            : data.filters.compare === "average"
              ? t("pace.vsAverage", { span: data.filters.span })
              : inProgress
                ? t("pace.vsSameDay", { ref: data.labels.compareRef })
                : t("pace.vsWhole", { ref: data.labels.compareRef })}
        </p>
      </div>

      <div ref={chartRef} className="h-[118px]">
        {width > 0 && (
          <PaceLines
            width={width}
            height={118}
            current={summary.current}
            compare={summary.compare}
            totalDays={totalDays}
            projection={summary.projectionMinor}
            budget={summary.budgetMinor}
            budgetLabel={
              summary.budgetMinor === null
                ? undefined
                : t("pace.budget", { amount: money(summary.budgetMinor, { noDecimals: true }) })
            }
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <LegendDot color="var(--ios-tint)">{data.labels.current}</LegendDot>
        {summary.compare.length > 0 && <LegendDot color="var(--ios-fill)">{data.labels.compare}</LegendDot>}
        {summary.projectionMinor !== null && (
          <LegendDot color="color-mix(in srgb, var(--ios-tint) 70%, transparent)">
            {t("pace.projection", { amount: money(summary.projectionMinor, { noDecimals: true }) })}
          </LegendDot>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ categories */

export function CategoriesSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money, percent } = useStatsFormat(data.currency);
  const [all, setAll] = useState(false);
  const rows = data.insights.categories;
  const shown = all ? rows : rows.slice(0, 5);
  const { from, to } = data.insights.period;

  return (
    <Section
      id="categories"
      title={t("categories.title")}
      {...(rows.length > 5
        ? {
            action: {
              label: all ? t("less") : t("all"),
              onClick: () => {
                setAll((value) => !value);
              },
            },
          }
        : {})}
    >
      {rows.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <div className="inset-group">
          {shown.map((row) => {
            const category = categoryOf(data.categories, row.categoryId);
            const color = category?.color ?? "var(--ios-gray)";
            const query = new URLSearchParams({ from, to });
            if (row.categoryId !== null) query.set("categoryIds", row.categoryId);
            if (data.filters.memberId !== null) query.set("paidByUserId", data.filters.memberId);
            if (data.filters.accountId !== null) query.set("accountId", data.filters.accountId);
            return (
              <Link
                key={row.categoryId ?? "none"}
                href={`/transactions?${query.toString()}`}
                transitionTypes={["ios-tab-forward"]}
                className="press-row flex min-h-[66px] items-center gap-3.5 pl-4"
              >
                <Ring value={row.share} size={38} stroke={4} color={color}>
                  <Symbol
                    name={categorySymbol(category?.icon, category?.slug)}
                    size={17}
                    weight={600}
                    style={{ color }}
                  />
                </Ring>
                <span className="row-sep flex min-h-[66px] min-w-0 flex-1 items-center gap-2 pr-4">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="t-headline truncate">{category?.name ?? t("uncategorised")}</span>
                    <span className="text-label-2 truncate text-[14px]">
                      {t("categories.count", {
                        count: row.count,
                        what: row.allFixed ? "fixed" : row.categoryId !== null && category?.kind === "income" ? "income" : "purchase",
                      })}
                      {" · "}
                      {t("categories.share", { percent: percent(row.share), kind: data.filters.kind })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="t-headline money">{money(row.totalMinor)}</span>
                    <Change
                      change={
                        row.compareMinor === null || row.compareMinor === 0
                          ? null
                          : row.totalMinor / row.compareMinor - 1
                      }
                      goodWhenUp={data.filters.kind === "income"}
                      same={t("same", { ref: data.labels.compareRef })}
                    />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- merchants */

export function MerchantsSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money } = useStatsFormat(data.currency);
  const [byCount, setByCount] = useState(false);
  const rows = [...data.insights.merchants]
    .sort((a, b) => (byCount ? b.count - a.count || b.totalMinor - a.totalMinor : 0))
    .slice(0, 5);

  return (
    <Section
      id="merchants"
      title={t("merchants.title")}
      action={{
        label: byCount ? t("merchants.byCount") : t("merchants.bySum"),
        onClick: () => {
          setByCount((value) => !value);
        },
      }}
    >
      {rows.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <div className="inset-group">
          {rows.map((row) => {
            const category = categoryOf(data.categories, row.categoryId);
            return (
              <Link
                key={row.name}
                href={`/transactions?search=1&q=${encodeURIComponent(row.name)}`}
                transitionTypes={["ios-push"]}
                className="press-row flex min-h-[72px] items-center gap-3.5 pl-4"
              >
                <SymbolTile
                  icon={categorySymbol(category?.icon, category?.slug)}
                  color={category?.color ?? "var(--ios-gray)"}
                  size={40}
                />
                <span className="row-sep flex min-h-[72px] min-w-0 flex-1 items-center gap-2 pr-4">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="t-headline truncate">{row.name}</span>
                    <span className="text-label-2 truncate text-[14px]">
                      {category?.name ?? t("uncategorised")}
                      {" · "}
                      {row.fixed
                        ? t("merchants.recurring")
                        : t("merchants.average", { amount: money(row.totalMinor / row.count) })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="t-headline money">{money(row.totalMinor)}</span>
                    <span className="t-footnote text-label-2">
                      {t("merchants.times", { count: row.count, span: data.filters.span })}
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ when */

const SLOTS = ["morning", "day", "evening", "night"] as const;
type Slot = (typeof SLOTS)[number];

function slotOf(hour: number): Slot {
  return hour >= 6 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "day" : hour >= 18 ? "evening" : "night";
}

function heat(ratio: number): { readonly background: string; readonly color?: string } {
  if (ratio <= 0) return { background: "var(--ios-fill-3)" };
  if (ratio < 0.25) return { background: "var(--ios-tint-soft)" };
  if (ratio < 0.5) return { background: "color-mix(in srgb, var(--ios-tint) 40%, transparent)" };
  if (ratio < 0.8) return { background: "color-mix(in srgb, var(--ios-tint) 70%, transparent)", color: "#fff" };
  return { background: "var(--ios-tint)", color: "#fff" };
}

function MiniBars({
  values,
  labels,
}: {
  readonly values: readonly number[];
  readonly labels: readonly string[];
}) {
  const max = Math.max(...values);
  const top = max > 0 ? values.indexOf(max) : -1;
  return (
    <div className="flex flex-1 gap-1.5">
      {values.map((value, index) => (
        <div key={labels[index]} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-[52px] w-full items-end">
            <span
              className="block w-full rounded-[6px]"
              style={{
                height: Math.max(6, max > 0 ? (value / max) * 52 : 6),
                backgroundColor: index === top ? "var(--ios-tint)" : "var(--ios-fill)",
              }}
            />
          </div>
          <span className={cn("t-caption truncate", index === top ? "text-tint font-bold" : "text-label-2")}>
            {labels[index]}
          </span>
        </div>
      ))}
    </div>
  );
}

export function WhenSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { percent } = useStatsFormat(data.currency);
  const { cells, weekdays, timed } = data.insights.when;
  const span = data.filters.span;
  const max = Math.max(0, ...cells.map((cell) => cell.totalMinor));
  // Calendar cells line up under Monday-first weekday columns.
  const offset = span === "year" ? 0 : (new Date(`${cells[0]?.key ?? data.today}T12:00:00`).getDay() + 6) % 7;

  // Hours on this device's clock: the instants are absolute.
  const slots = SLOTS.map((slot) => timed.filter(([at]) => slotOf(new Date(at).getHours()) === slot).length);
  const topSlotIndex = slots.indexOf(Math.max(...slots));
  const topSlot = SLOTS[topSlotIndex] ?? "evening";
  const weekdayTotal = weekdays.reduce((a, b) => a + b, 0);
  const topWeekday = weekdays.indexOf(Math.max(...weekdays));

  return (
    <Section id="when" title={t("when.title")} note={data.labels.chip}>
      <div className="inset-group flex flex-col gap-4 p-4">
        <div className={cn("grid gap-1.5", span === "year" ? "grid-cols-4" : "grid-cols-7")}>
          {span !== "year" &&
            data.labels.weekdays.map((label) => (
              <span key={label} className="t-caption text-label-2 pb-1 text-center">
                {label}
              </span>
            ))}
          {Array.from({ length: offset }, (_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {cells.map((cell, index) => {
            const future = cell.key > data.today;
            const style = future ? { background: "var(--ios-fill-3)" } : heat(max === 0 ? 0 : cell.totalMinor / max);
            return (
              <span
                key={cell.key}
                className={cn(
                  "grid h-[34px] place-items-center rounded-[9px] text-[15px]",
                  future && "text-label-2 opacity-50",
                  cell.key === data.today && "font-bold",
                )}
                style={{ backgroundColor: style.background, color: style.color }}
              >
                {span === "year" ? data.labels.yearMonths[index] : Number(cell.key.slice(8))}
              </span>
            );
          })}
        </div>

        <div className="flex gap-5">
          <div className="flex flex-1 flex-col gap-2">
            <span className="t-footnote text-label-2">{t("when.weekdays")}</span>
            <MiniBars values={weekdays} labels={data.labels.weekdays} />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <span className="t-footnote text-label-2">{t("when.hours")}</span>
            {timed.length === 0 ? (
              <span className="t-footnote text-label-3 flex h-[70px] items-center">{t("when.noTimes")}</span>
            ) : (
              <MiniBars values={slots} labels={SLOTS.map((slot) => t(`when.slot.${slot}`))} />
            )}
          </div>
        </div>

        {weekdayTotal > 0 && (
          <p className="flex gap-2.5">
            <Symbol name="lightbulb" size={20} className="text-ios-yellow shrink-0" />
            <span className="t-subhead">
              {t("when.insightDay", {
                weekday: String(topWeekday + 1),
                percent: percent((weekdays[topWeekday] ?? 0) / weekdayTotal),
              })}
              {timed.length >= 3 &&
                ` ${t("when.insightSlot", {
                  slot: topSlot,
                  percent: percent((slots[topSlotIndex] ?? 0) / timed.length),
                })}`}
            </span>
          </p>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- fixed / flexible */

export function FixedSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money, percent } = useStatsFormat(data.currency);
  const split = data.insights.fixedFlexible;
  const last = split.months.length - 1;

  return (
    <Section id="fixed" title={t("fixed.title")} note={t("sixMonths")}>
      <div className="inset-group flex flex-col gap-4 p-[18px]">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <LegendDot color="var(--ios-tint)">{t("fixed.fixed")}</LegendDot>
            <span className="money text-[18px] leading-6 font-bold tracking-[-0.02em] whitespace-nowrap">
              {t("fixed.perMonth", { amount: money(split.fixedAverageMinor, { noDecimals: true }) })}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <LegendDot color="var(--stats-flexible)">{t("fixed.flexible")}</LegendDot>
            <span className="money text-[18px] leading-6 font-bold tracking-[-0.02em] whitespace-nowrap">
              {t("fixed.aboutPerMonth", { amount: money(split.flexibleAverageMinor, { noDecimals: true }) })}
            </span>
          </div>
        </div>
        <StackedColumns
          columns={split.months.map((month, index) => ({
            key: month.month,
            label: data.labels.months[index] ?? "",
            strong: index === last,
            segments: [
              { value: month.fixedMinor, color: "var(--ios-tint)" },
              { value: month.flexibleMinor, color: "var(--stats-flexible)" },
              { value: month.projectedMinor, color: "var(--stats-flexible)", opacity: 0.35 },
            ],
          }))}
        />
        {split.fixedAverageMinor + split.flexibleAverageMinor > 0 && (
          <p className="t-subhead text-label-2">
            {t("fixed.note", {
              percent: percent(split.fixedShare),
              amount: money(split.flexibleAverageMinor, { noDecimals: true }),
            })}
          </p>
        )}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- members */

export function MembersSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money, percent } = useStatsFormat(data.currency);
  const { totals, months, flexibleShares } = data.insights.members;
  const total = totals.reduce((sum, m) => sum + m.totalMinor, 0);
  const member = (id: string) => data.members.find((m) => m.id === id);
  const order = data.members.map((m) => m.id);
  const last = months.length - 1;

  return (
    <Section id="members" title={t("members.title", { kind: data.filters.kind })} note={t("sixMonths")}>
      <div className="inset-group flex flex-col gap-4 p-[18px]">
        <div className="grid grid-cols-2 gap-3">
          {data.members.map((m) => {
            const amount = totals.find((row) => row.memberId === m.id)?.totalMinor ?? 0;
            return (
              <div key={m.id} className="flex min-w-0 items-center gap-2">
                <MemberAvatar name={m.name} color={m.color} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="money text-[20px] leading-6 font-bold tracking-[-0.02em]">{money(amount)}</span>
                  <span className="t-footnote text-label-2 truncate">
                    {m.name} · {percent(total === 0 ? 0 : amount / total)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <StackedColumns
          height={116}
          columns={months.map((month, index) => ({
            key: month.month,
            label: data.labels.months[index] ?? "",
            strong: index === last,
            segments: order.map((id) => ({
              value: month.byMember[id] ?? 0,
              color: member(id)?.color ?? "var(--ios-gray)",
            })),
          }))}
        />
        {flexibleShares.length === 2 && (
          <p className="t-subhead text-label-2">
            {t("members.note", {
              first: member(flexibleShares[0]?.memberId ?? "")?.name ?? "",
              firstShare: percent(flexibleShares[0]?.share ?? 0),
              second: member(flexibleShares[1]?.memberId ?? "")?.name ?? "",
              secondShare: percent(flexibleShares[1]?.share ?? 0),
            })}
          </p>
        )}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- savings */

export function SavingsSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money, percent } = useStatsFormat(data.currency);
  const { months, rate, savedMinor } = data.insights.savings;
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeMinor, m.expenseMinor]));
  const last = months.length - 1;

  return (
    <Section id="savings" title={t("savings.title")} note={t("sixMonths")}>
      <div className="inset-group flex flex-col gap-4 p-[18px]">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="t-subhead text-label-2">{t("savings.rate")}</span>
            <span
              className={cn(
                "text-[22px] leading-7 font-bold tracking-[-0.02em]",
                rate === null || rate >= 0 ? "text-ios-green" : "text-ios-red",
              )}
            >
              {rate === null ? "—" : t("savings.ofIncome", { percent: percent(rate) })}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="t-subhead text-label-2">{t("savings.saved")}</span>
            <span className="money text-[22px] leading-7 font-bold tracking-[-0.02em]">
              {money(savedMinor, { noDecimals: true, signed: true })}
            </span>
          </div>
        </div>
        <div className="flex gap-3.5">
          {months.map((month, index) => {
            const monthRate =
              month.incomeMinor === 0 ? null : (month.incomeMinor - month.expenseMinor) / month.incomeMinor;
            return (
              <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "t-caption font-semibold",
                    monthRate !== null && monthRate < 0 ? "text-ios-red" : "text-ios-green",
                  )}
                >
                  {!month.complete || monthRate === null ? "…" : percent(monthRate)}
                </span>
                <div className="flex h-[118px] w-full items-end gap-1">
                  <span
                    className="bg-ios-green block flex-1 rounded-[6px]"
                    style={{ height: Math.max(4, (month.incomeMinor / max) * 118) }}
                  />
                  <span
                    className="bg-ios-fill block flex-1 rounded-[6px]"
                    style={{ height: Math.max(4, (month.expenseMinor / max) * 118) }}
                  />
                </div>
                <span className={cn("t-caption", index === last ? "font-bold" : "text-label-2")}>
                  {data.labels.months[index]}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4">
          <LegendDot color="var(--ios-green)">{t("savings.income")}</LegendDot>
          <LegendDot color="var(--ios-fill)">{t("savings.expense")}</LegendDot>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- budgets */

export function BudgetsSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const tb = useTranslations("ios.budgets");
  const { money } = useStatsFormat(data.currency);
  const picked = new Set(data.filters.categoryIds);
  const budgets = data.budgets.filter((b) => picked.size === 0 || picked.has(b.categoryId));

  return (
    <Section
      id="budgets"
      title={t("budgets.title")}
      action={{ label: t("all"), href: "/budgets", transitionTypes: ["ios-tab-forward"] }}
    >
      {budgets.length === 0 ? (
        <Link href="/budgets" transitionTypes={["ios-tab-forward"]} className="inset-group t-body text-tint p-4 text-center">
          {t("budgets.empty")}
        </Link>
      ) : (
        <div className="inset-group">
          {budgets.map((budget) => {
            const over = budget.spentMinor > budget.limitMinor;
            const left = (budget.limitMinor - budget.spentMinor) as Minor;
            const verdict =
              budget.isFixed && budget.spentMinor >= budget.limitMinor && !over
                ? tb("paid")
                : over
                  ? tb("over", { amount: money(negateMinor(left), { noDecimals: true }) })
                  : tb("left", { amount: money(left, { noDecimals: true }) });
            return (
              <div key={budget.id} className="flex min-h-[66px] items-center gap-3.5 pl-4">
                <Ring
                  value={budget.spentMinor / Math.max(1, budget.limitMinor)}
                  size={38}
                  stroke={4}
                  color={over ? "var(--ios-red)" : budget.categoryColor}
                >
                  <Symbol
                    name={categorySymbol(budget.categoryIcon, budget.categorySlug)}
                    size={17}
                    weight={600}
                    style={{ color: budget.categoryColor }}
                  />
                </Ring>
                <span className="row-sep flex min-h-[66px] min-w-0 flex-1 items-center gap-2 pr-4">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="t-headline truncate">{budget.categoryName}</span>
                    <span className="text-label-2 text-[14px]">
                      {tb("of", {
                        spent: money(budget.spentMinor, { noDecimals: true }),
                        limit: money(budget.limitMinor, { noDecimals: true }),
                      })}
                    </span>
                  </span>
                  <span className={cn("t-subhead shrink-0 font-medium", over ? "text-ios-red" : "text-label-2")}>
                    {verdict}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------- net worth */

export function NetWorthSection({ data }: { readonly data: StatsData }) {
  const t = useTranslations("ios.stats");
  const { money } = useStatsFormat(data.currency);
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const points = data.netWorth.map((point) => point.balanceMinor as number);
  const first = points[0] ?? 0;
  const last = points.at(-1) ?? 0;
  const low = Math.min(...points, 0);
  const shifted = points.map((value) => value - low);

  return (
    <Section id="networth" title={t("networth.title")} note={t("twelveMonths")}>
      <div className="inset-group flex flex-col gap-3 p-[18px]">
        <div className="flex items-end gap-2.5">
          <span className="money text-[28px] leading-[34px] font-bold tracking-[-0.03em]">{money(last)}</span>
          <span className={cn("pb-0.5 text-[15px] font-semibold", last >= first ? "text-ios-green" : "text-ios-red")}>
            {money(last - first, { noDecimals: true, signed: true })}
          </span>
        </div>
        <div ref={chartRef} className="h-[96px]">
          {width > 0 && points.length > 1 && (
            <PaceLines
              width={width}
              height={96}
              current={shifted.slice(1)}
              origin={shifted[0] ?? 0}
              compare={[]}
              totalDays={shifted.length - 1}
              strokeWidth={3}
            />
          )}
        </div>
      </div>
    </Section>
  );
}

function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="inset-group t-subhead text-label-2 p-4 text-center">{children}</p>;
}
