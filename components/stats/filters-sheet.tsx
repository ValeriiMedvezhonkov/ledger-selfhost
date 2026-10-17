"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassPill, ProminentButton } from "@/components/ios/glass";
import { Segmented, Switch, TogglePill } from "@/components/ios/controls";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import {
  defaultStatsFilters,
  type StatsCompare,
  type StatsFilters,
  type StatsKind,
  type StatsSpan,
} from "@/lib/stats-filters";
import type { ISODate } from "@/lib/date";
import type { StatsCategory, StatsMember } from "@/components/stats/types";

/**
 * Фильтры (board L19): every way to slice Статистика in one medium sheet.
 * Choices are a draft until «Показать статистику» writes them to the URL in
 * one go, as the list's filter sheet does.
 */
export function StatsFiltersSheet({
  open,
  onOpenChange,
  filters,
  today,
  categories,
  members,
  accounts,
  apply,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly filters: StatsFilters;
  readonly today: ISODate;
  readonly categories: readonly StatsCategory[];
  readonly members: readonly StatsMember[];
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly apply: (filters: StatsFilters) => void;
}) {
  const t = useTranslations("ios.stats");
  const [draft, setDraft] = useState(filters);
  // Each opening starts from what the screen shows, not an abandoned draft.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(filters);
  }
  const set = (patch: Partial<StatsFilters>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const shown = categories.filter((c) => draft.kind === "all" || c.kind === draft.kind);
  const accountName = accounts.find((a) => a.id === draft.accountId)?.name ?? t("filters.allAccounts");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("filters.title")}>
      <SheetHeader
        title={t("filters.title")}
        onClose={() => {
          onOpenChange(false);
        }}
        trailing={
          <GlassPill
            onClick={() => {
              setDraft(defaultStatsFilters(today));
            }}
            className="font-medium"
          >
            {t("filters.reset")}
          </GlassPill>
        }
      />
      <div className="flex max-h-[62dvh] flex-col gap-4 overflow-y-auto px-4 pt-3 pb-1 overscroll-contain *:shrink-0">
        <Group title={t("filters.period")}>
          <Segmented<StatsSpan>
            label={t("filters.period")}
            value={draft.span}
            onChange={(span) => {
              set({ span, at: today });
            }}
            options={[
              { value: "week", label: t("filters.week") },
              { value: "month", label: t("filters.month") },
              { value: "year", label: t("filters.year") },
            ]}
          />
        </Group>
        <Group
          title={
            draft.categoryIds.length > 0
              ? t("filters.categoriesCount", { count: draft.categoryIds.length })
              : t("filters.categories")
          }
        >
          <div className="flex flex-wrap gap-2">
            {shown.map((category) => (
              <TogglePill
                key={category.id}
                dot={category.color}
                selected={draft.categoryIds.includes(category.id)}
                onClick={() => {
                  set({
                    categoryIds: draft.categoryIds.includes(category.id)
                      ? draft.categoryIds.filter((id) => id !== category.id)
                      : [...draft.categoryIds, category.id],
                  });
                }}
              >
                {category.name}
              </TogglePill>
            ))}
          </div>
        </Group>
        {members.length > 1 && (
          <Group title={t("filters.who")}>
            <Segmented
              label={t("filters.who")}
              value={draft.memberId ?? "all"}
              onChange={(value) => {
                set({ memberId: value === "all" ? null : value });
              }}
              options={[
                { value: "all", label: t("filters.both") },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </Group>
        )}
        <Group title={t("filters.account")}>
          <GlassMenu
            label={t("filters.account")}
            align="start"
            trigger={
              <button
                type="button"
                className="bg-ios-fill-3 flex h-[46px] w-full items-center gap-2 rounded-full pr-3.5 pl-4 text-left"
              >
                <span className="t-body min-w-0 flex-1 truncate">{accountName}</span>
                <Symbol name="unfold_more" size={20} weight={600} className="text-label-2" />
              </button>
            }
            entries={[
              {
                key: "all",
                label: t("filters.allAccounts"),
                checked: draft.accountId === null,
                onSelect: () => {
                  set({ accountId: null });
                },
              },
              ...accounts.map((a) => ({
                key: a.id,
                label: a.name,
                checked: draft.accountId === a.id,
                onSelect: () => {
                  set({ accountId: a.id });
                },
              })),
            ]}
          />
        </Group>
        <Group title={t("filters.count")}>
          <Segmented<StatsKind>
            label={t("filters.count")}
            value={draft.kind}
            onChange={(kind) => {
              // Categories of the other kind would match nothing.
              const keep = categories
                .filter((c) => kind === "all" || c.kind === kind)
                .map((c) => c.id);
              set({ kind, categoryIds: draft.categoryIds.filter((id) => keep.includes(id)) });
            }}
            options={[
              { value: "expense", label: t("filters.expense") },
              { value: "income", label: t("filters.income") },
              { value: "all", label: t("filters.everything") },
            ]}
          />
          <label className="bg-ios-fill-3 flex h-[52px] items-center gap-3 rounded-[18px] pr-2 pl-4">
            <span className="t-body min-w-0 flex-1">{t("filters.withoutFixed")}</span>
            <Switch
              checked={draft.withoutFixed}
              onChange={(withoutFixed) => {
                set({ withoutFixed });
              }}
              label={t("filters.withoutFixed")}
            />
          </label>
        </Group>
        <Group title={t("filters.compare")}>
          <Segmented<StatsCompare>
            label={t("filters.compare")}
            value={draft.compare}
            onChange={(compare) => {
              set({ compare });
            }}
            options={[
              { value: "previous", label: t("filters.previous", { span: draft.span }) },
              { value: "average", label: t("filters.average", { span: draft.span }) },
            ]}
          />
        </Group>
      </div>
      <div className="px-4 pt-4 pb-7">
        <ProminentButton
          onClick={() => {
            apply(draft);
            onOpenChange(false);
          }}
        >
          {t("filters.show")}
        </ProminentButton>
      </div>
    </Sheet>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="t-footnote text-label-2 font-semibold">{title}</h3>
      {children}
    </section>
  );
}
