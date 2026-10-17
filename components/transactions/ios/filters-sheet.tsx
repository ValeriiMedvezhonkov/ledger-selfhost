"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { endOfMonth, endOfWeek, endOfYear, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import { toISODate } from "@/lib/date";
import { countTransactionsAction } from "@/app/(app)/transactions/actions";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassPill, ProminentButton } from "@/components/ios/glass";
import { Segmented, TogglePill } from "@/components/ios/controls";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import type { PickerCategory } from "@/components/transactions/ios/category-picker-sheet";
import type { TxFilterPatch, TxFilterState } from "@/components/transactions/ios/filter-url";

type Span = "week" | "month" | "year";

function spanRange(span: Span, today: Date): { from: string; to: string } {
  switch (span) {
    case "week":
      return {
        from: toISODate(startOfWeek(today, { weekStartsOn: 1 })),
        to: toISODate(endOfWeek(today, { weekStartsOn: 1 })),
      };
    case "month":
      return { from: toISODate(startOfMonth(today)), to: toISODate(endOfMonth(today)) };
    case "year":
      return { from: toISODate(startOfYear(today)), to: toISODate(endOfYear(today)) };
  }
}

/**
 * Фильтры (board L06): a medium glass sheet. Choices are a local draft; the
 * button underneath counts what the draft would show — live, from the server
 * — and applies everything in one URL write.
 */
export function FiltersSheet({
  open,
  onOpenChange,
  state,
  today,
  categories,
  members,
  accounts,
  apply,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly state: TxFilterState;
  readonly today: string;
  readonly categories: readonly PickerCategory[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly apply: (patch: TxFilterPatch) => void;
}) {
  const t = useTranslations("ios.tx");
  const now = new Date(`${today}T12:00:00`);
  const [span, setSpan] = useState<Span>("month");
  const [categoryIds, setCategoryIds] = useState<readonly string[]>(state.categoryIds);
  const [member, setMember] = useState<string>(state.paidByUserId ?? "all");
  const [account, setAccount] = useState<string | null>(state.accountId);
  const count = useAction(countTransactionsAction);

  const range = spanRange(span, now);
  const executeCount = count.execute;
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      executeCount({
        from: range.from,
        to: range.to,
        categoryIds: [...categoryIds],
        ...(member === "all" ? {} : { paidByUserId: member }),
        ...(account === null ? {} : { accountId: account }),
        ...(state.q === "" ? {} : { q: state.q }),
        sort: "date-desc",
        page: 1,
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, range.from, range.to, categoryIds, member, account, state.q, executeCount]);

  const shown = count.result.data?.count;
  const accountName = accounts.find((a) => a.id === account)?.name ?? t("allAccounts");
  const expense = categories.filter((c) => c.kind === "expense");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("filters")}>
      <SheetHeader
        title={t("filters")}
        onClose={() => {
          onOpenChange(false);
        }}
        trailing={
          <GlassPill
            onClick={() => {
              setSpan("month");
              setCategoryIds([]);
              setMember("all");
              setAccount(null);
            }}
            className="font-medium"
          >
            {t("reset")}
          </GlassPill>
        }
      />
      <div className="flex max-h-[62dvh] flex-col gap-4 overflow-y-auto px-4 pt-3 pb-1 overscroll-contain *:shrink-0">
        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("period")}</h3>
          <Segmented<Span>
            label={t("period")}
            value={span}
            onChange={setSpan}
            options={[
              { value: "week", label: t("week") },
              { value: "month", label: t("month") },
              { value: "year", label: t("year") },
            ]}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">
            {categoryIds.length > 0
              ? t("categoriesCount", { count: categoryIds.length })
              : t("categories")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {expense.map((category) => (
              <TogglePill
                key={category.id}
                dot={category.color}
                selected={categoryIds.includes(category.id)}
                onClick={() => {
                  setCategoryIds((current) =>
                    current.includes(category.id)
                      ? current.filter((id) => id !== category.id)
                      : [...current, category.id],
                  );
                }}
              >
                {category.name}
              </TogglePill>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("whoPaid")}</h3>
          <Segmented
            label={t("whoPaid")}
            value={member}
            onChange={setMember}
            options={[
              { value: "all", label: t("both") },
              ...members.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("account")}</h3>
          <GlassMenu
            label={t("account")}
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
              { key: "all", label: t("allAccounts"), checked: account === null, onSelect: () => { setAccount(null); } },
              ...accounts.map((a) => ({
                key: a.id,
                label: a.name,
                checked: account === a.id,
                onSelect: () => {
                  setAccount(a.id);
                },
              })),
            ]}
          />
        </section>
      </div>
      <div className="px-4 pt-4 pb-7">
        <ProminentButton
          onClick={() => {
            apply({
              from: range.from,
              to: range.to,
              allTime: false,
              categoryIds,
              paidByUserId: member === "all" ? null : member,
              accountId: account,
            });
            onOpenChange(false);
          }}
        >
          {shown === undefined ? t("show") : t("showCount", { count: shown })}
        </ProminentButton>
      </div>
    </Sheet>
  );
}
