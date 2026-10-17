"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import type { Minor } from "@/lib/money";
import type { ISODate } from "@/lib/date";
import { toISODate } from "@/lib/date";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import {
  changeTransactionCategory,
  deleteTransaction,
  deleteTransactions,
  duplicateTransaction,
  makeTransactionRecurring,
  splitTransaction,
} from "@/app/(app)/transactions/actions";
import type { TransactionListItem } from "@/lib/queries";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassGroup, GlassPill } from "@/components/ios/glass";
import { GlassChip } from "@/components/ios/controls";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import { IosAlert } from "@/components/ios/alert";
import { SwipeActions } from "@/components/ios/swipe-actions";
import { ContextMenuTarget } from "@/components/ios/context-menu";
import { TransactionRow, useWhen } from "@/components/ios/transaction-row";
import { useAddTransaction } from "@/components/transactions/add-transaction";
import {
  CategoryPickerSheet,
  type PickerCategory,
} from "@/components/transactions/ios/category-picker-sheet";
import { FiltersSheet } from "@/components/transactions/ios/filters-sheet";
import { SearchMode } from "@/components/transactions/ios/search-mode";
import { useFilterNav, type TxFilterState } from "@/components/transactions/ios/filter-url";
import { cn } from "@/lib/utils";

export interface TransactionsScreenProps {
  readonly items: readonly TransactionListItem[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly netMinor: Minor;
  readonly today: ISODate;
  readonly filters: TxFilterState;
  readonly searching: boolean;
  readonly baseCurrency: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly PickerCategory[];
  readonly members: readonly { readonly id: string; readonly name: string; readonly color: string }[];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function TransactionsScreen(props: TransactionsScreenProps) {
  const {
    items,
    total,
    hasMore,
    netMinor,
    today,
    filters,
    searching,
    baseCurrency,
    accounts,
    categories,
    members,
  } = props;
  const t = useTranslations("ios.tx");
  const f = useFormats();
  const router = useRouter();
  const compose = useAddTransaction();
  const nav = useFilterNav(filters);
  const whenRelative = useWhen(today);
  // Inside a day group the header already names the day: rows show only
  // the clock time, when the app knows it.
  const when = (row: TransactionListItem) => (row.occurredAt === null ? "" : whenRelative(row));
  const [, startTransition] = useTransition();

  const [filtersOpen, setFiltersOpenRaw] = useState(false);
  // Each opening remounts the sheet, so its draft starts from the URL again.
  const [filtersKey, setFiltersKey] = useState(0);
  const setFiltersOpen = (open: boolean) => {
    if (open) setFiltersKey((key) => key + 1);
    setFiltersOpenRaw(open);
  };
  const [picking, setPicking] = useState<TransactionListItem | null>(null);
  const [confirming, setConfirming] = useState<TransactionListItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmMany, setConfirmMany] = useState(false);

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      router.refresh();
    },
    onError: ({ error }: { error: { serverError?: string | undefined } }) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });
  const remove = useAction(deleteTransaction, {
    ...done(t("deleted")),
    onSettled: () => {
      setConfirming(null);
    },
  });
  const removeMany = useAction(deleteTransactions, {
    ...done(t("deletedMany")),
    onSettled: () => {
      setConfirmMany(false);
      setSelecting(false);
      setSelected(new Set());
    },
  });
  const duplicate = useAction(duplicateTransaction, done(t("duplicated")));
  const split = useAction(splitTransaction, done(t("splitDone")));
  const recurring = useAction(makeTransactionRecurring, done(t("recurringDone")));
  const recategorize = useAction(changeTransactionCategory, done(t("categoryChanged")));

  /* ------------------------------------------------------------ period */

  const monthStart = new Date(`${today}T12:00:00`);
  const isWholeMonth =
    filters.from !== null &&
    filters.to !== null &&
    filters.from.endsWith("-01") &&
    toISODate(endOfMonth(new Date(`${filters.from}T12:00:00`))) === filters.to;
  const periodLabel = filters.allTime
    ? t("allTime")
    : isWholeMonth
      ? capitalize(format(new Date(`${filters.from}T12:00:00`), "LLLL", { locale: f.calendar }))
      : filters.from !== null && filters.to !== null
        ? `${f.dateShort(filters.from)} – ${f.dateShort(filters.to)}`
        : t("allTime");
  const subtitleMonth = filters.allTime
    ? t("allTime")
    : isWholeMonth
      ? capitalize(format(new Date(`${filters.from}T12:00:00`), "LLLL yyyy", { locale: f.calendar }))
      : periodLabel;

  const months = Array.from({ length: 12 }, (_, index) => subMonths(startOfMonth(monthStart), index));

  /* ------------------------------------------------------------ groups */

  const groups = useMemo(() => {
    const byDay = new Map<string, TransactionListItem[]>();
    for (const item of items) {
      const list = byDay.get(item.occurredOn);
      if (list === undefined) byDay.set(item.occurredOn, [item]);
      else list.push(item);
    }
    return [...byDay.entries()].map(([day, rows]) => ({
      day,
      rows,
      net: rows.reduce((sum, row) => (row.isTransfer ? sum : sum + row.amountBaseMinor), 0) as Minor,
    }));
  }, [items]);

  const memberName = members.find((m) => m.id === filters.paidByUserId)?.name;
  const accountName = accounts.find((a) => a.id === filters.accountId)?.name;
  const categoryLabel =
    filters.categoryIds.length === 0
      ? t("category")
      : filters.categoryIds.length === 1
        ? (categories.find((c) => c.id === filters.categoryIds[0])?.name ?? t("category"))
        : t("categoriesCount", { count: filters.categoryIds.length });

  const share = async (row: TransactionListItem) => {
    const text = `${row.merchant ?? row.categoryName ?? ""} · ${minus(f.money(row.amountMinor, row.currency, { signed: true }))} · ${f.date(row.occurredOn)}`;
    try {
      if (typeof navigator.share === "function") await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success(t("copied"));
      }
    } catch {
      // Dismissing the share sheet is not an error worth reporting.
    }
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (searching) {
    return (
      <SearchMode
        items={items}
        total={total}
        netMinor={netMinor}
        today={today}
        query={filters.q}
        baseCurrency={baseCurrency}
        onQuery={(q) => {
          startTransition(() => {
            nav({ q, allTime: true });
          });
        }}
      />
    );
  }

  return (
    <>
      <NavBar
        large
        title={t("title")}
        subtitle={t("subtitle", {
          period: subtitleMonth,
          count: total,
          amount: minus(f.money(netMinor, baseCurrency)),
        })}
        inlineSubtitle={subtitleMonth}
        trailing={
          selecting ? (
            <GlassPill
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              {t("done")}
            </GlassPill>
          ) : (
            <GlassGroup
              items={[
                {
                  icon: "check_circle",
                  label: t("select"),
                  onClick: () => {
                    setSelecting(true);
                  },
                },
                {
                  icon: "tune",
                  label: t("filters"),
                  onClick: () => {
                    setFiltersOpen(true);
                  },
                },
                {
                  icon: "add",
                  label: t("add"),
                  onClick: compose.open,
                },
              ]}
            />
          )
        }
      />

      <ScreenBody className="gap-[18px] pt-3">
        {/* Search field — opens the search mode with the keyboard up. */}
        <Link
          href={`/transactions?search=1`}
          transitionTypes={["ios-push"]}
          className="bg-ios-fill-3 text-label-2 flex h-10 items-center gap-1.5 rounded-full px-3"
        >
          <Symbol name="search" size={20} />
          <span className="t-body min-w-0 flex-1 truncate">{t("searchPlaceholder")}</span>
          <Symbol name="mic" size={20} />
        </Link>

        {/* Filter chips, horizontally scrollable to the screen edge. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <GlassMenu
            label={t("period")}
            align="start"
            trigger={<GlassChip active={!filters.allTime}>{periodLabel}</GlassChip>}
            entries={[
              ...months.map((month) => {
                const from = toISODate(month);
                return {
                  key: from,
                  label: capitalize(format(month, "LLLL yyyy", { locale: f.calendar })),
                  checked: filters.from === from && isWholeMonth,
                  onSelect: () => {
                    nav({ from, to: toISODate(endOfMonth(month)), allTime: false });
                  },
                };
              }),
              "separator" as const,
              {
                key: "all",
                label: t("allTime"),
                checked: filters.allTime,
                onSelect: () => {
                  nav({ allTime: true, from: null, to: null });
                },
              },
            ]}
          />
          <GlassChip
            active={filters.categoryIds.length > 0}
            onClick={() => {
              setFiltersOpen(true);
            }}
          >
            {categoryLabel}
          </GlassChip>
          <GlassMenu
            label={t("whoPaid")}
            align="start"
            trigger={<GlassChip active={memberName !== undefined}>{memberName ?? t("who")}</GlassChip>}
            entries={[
              { key: "all", label: t("both"), checked: filters.paidByUserId === null, onSelect: () => { nav({ paidByUserId: null }); } },
              ...members.map((m) => ({
                key: m.id,
                label: m.name,
                checked: filters.paidByUserId === m.id,
                onSelect: () => {
                  nav({ paidByUserId: m.id });
                },
              })),
            ]}
          />
          <GlassMenu
            label={t("account")}
            align="start"
            trigger={<GlassChip active={accountName !== undefined}>{accountName ?? t("account")}</GlassChip>}
            entries={[
              { key: "all", label: t("allAccounts"), checked: filters.accountId === null, onSelect: () => { nav({ accountId: null }); } },
              ...accounts.map((a) => ({
                key: a.id,
                label: a.name,
                checked: filters.accountId === a.id,
                onSelect: () => {
                  nav({ accountId: a.id });
                },
              })),
            ]}
          />
        </div>

        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Symbol name="receipt_long" size={44} className="text-label-3" />
            <p className="t-headline">{t("emptyTitle")}</p>
            <p className="t-subhead text-label-2">{t("emptyBody")}</p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.day} className="flex flex-col gap-1.5">
            <header className="flex items-center gap-2 px-4">
              <h2 className="t-subhead text-label-2 min-w-0 flex-1 truncate font-semibold">
                {capitalize(format(new Date(`${group.day}T12:00:00`), "EEEE, d MMMM", { locale: f.calendar }))}
              </h2>
              <span className="t-subhead text-label-2 money">
                {minus(f.money(group.net, baseCurrency, { signed: group.net > 0 }))}
              </span>
            </header>
            <div className="inset-group">
              {group.rows.map((row) => {
                const rowNode = selecting ? (
                  <button
                    type="button"
                    onClick={() => {
                      toggle(row.id);
                    }}
                    className="flex w-full items-center"
                  >
                    <span
                      className={cn(
                        "ml-4 grid size-6 shrink-0 place-items-center rounded-full border-2",
                        selected.has(row.id) ? "border-tint bg-tint text-white" : "border-label-3",
                      )}
                    >
                      {selected.has(row.id) && <Symbol name="check" size={16} weight={700} />}
                    </span>
                    <span className="pointer-events-none min-w-0 flex-1">
                      <TransactionRow row={row} when={when(row)} />
                    </span>
                  </button>
                ) : (
                  <TransactionRow row={row} when={when(row)} />
                );
                if (selecting) return <div key={row.id}>{rowNode}</div>;
                return (
                  <ContextMenuTarget
                    key={row.id}
                    quickActions={[
                      { key: "edit", label: t("edit"), icon: "edit", onSelect: () => { compose.edit(row.id); } },
                      { key: "copy", label: t("copy"), icon: "content_copy", onSelect: () => { duplicate.execute({ id: row.id }); } },
                      { key: "share", label: t("share"), icon: "ios_share", onSelect: () => { void share(row); } },
                    ]}
                    entries={
                      row.isTransfer
                        ? [{ key: "delete", label: t("delete"), icon: "delete", destructive: true, onSelect: () => { setConfirming(row); } }]
                        : [
                            { key: "category", label: t("changeCategory"), icon: "sell", submenu: true, onSelect: () => { setPicking(row); } },
                            ...(row.splitGroupId === null && members.length === 2
                              ? [{ key: "split", label: t("splitHalf"), icon: "call_split" as const, onSelect: () => { split.execute({ id: row.id }); } }]
                              : []),
                            ...(row.recurringRuleId === null
                              ? [{ key: "recurring", label: t("makeRecurring"), icon: "repeat" as const, onSelect: () => { recurring.execute({ id: row.id, frequency: "monthly" }); } }]
                              : []),
                            "separator" as const,
                            { key: "delete", label: t("delete"), icon: "delete", destructive: true, onSelect: () => { setConfirming(row); } },
                          ]
                    }
                  >
                    <SwipeActions
                      actions={[
                        ...(row.isTransfer
                          ? []
                          : [{ key: "cat", label: t("changeCategory"), icon: "sell" as const, color: "var(--ios-orange)", onSelect: () => { setPicking(row); } }]),
                        { key: "del", label: t("delete"), icon: "delete", color: "var(--ios-red)", onSelect: () => { setConfirming(row); } },
                      ]}
                    >
                      {rowNode}
                    </SwipeActions>
                  </ContextMenuTarget>
                );
              })}
            </div>
          </section>
        ))}

        {hasMore && (
          <button
            type="button"
            onClick={() => {
              nav({ page: filters.page + 1 });
            }}
            className="inset-group press-row t-body text-tint h-[52px]"
          >
            {t("more")}
          </button>
        )}
      </ScreenBody>

      {selecting && (
        <div
          className="ios-fixed z-[55] px-5"
          style={{ bottom: "calc(max(14px, calc(var(--safe-bottom) - 6px)) - var(--vp-fix))" }}
        >
          <div className="glass glass-strong flex h-[62px] items-center gap-3 rounded-[31px] pr-2 pl-5">
            <span className="t-headline min-w-0 flex-1">
              {t("selectedCount", { count: selected.size })}
            </span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => {
                setConfirmMany(true);
              }}
              className="bg-ios-red press t-headline h-12 rounded-full px-5 text-white disabled:opacity-40"
            >
              {t("delete")}
            </button>
          </div>
        </div>
      )}

      <FiltersSheet
        key={filtersKey}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        state={filters}
        today={today}
        categories={categories}
        members={members}
        accounts={accounts}
        apply={(patch) => {
          nav(patch);
        }}
      />

      <CategoryPickerSheet
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        categories={categories}
        kind={picking !== null && picking.amountMinor > 0 ? "income" : "expense"}
        selectedId={picking?.categoryId ?? null}
        onPick={(categoryId) => {
          if (picking !== null) recategorize.execute({ id: picking.id, categoryId });
        }}
      />

      <IosAlert
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t("deleteTitle")}
        message={
          confirming === null
            ? undefined
            : t("deleteMessage", {
                what: confirming.merchant ?? confirming.categoryName ?? t("title"),
                amount: minus(f.money(confirming.amountMinor, confirming.currency, { signed: true })),
                date: f.date(confirming.occurredOn),
                account: confirming.accountName,
              })
        }
        cancelLabel={t("cancel")}
        confirmLabel={t("delete")}
        pending={remove.isPending}
        onConfirm={() => {
          if (confirming !== null) remove.execute({ id: confirming.id });
        }}
      />
      <IosAlert
        open={confirmMany}
        onOpenChange={setConfirmMany}
        title={t("deleteManyTitle", { count: selected.size })}
        cancelLabel={t("cancel")}
        confirmLabel={t("delete")}
        pending={removeMany.isPending}
        onConfirm={() => {
          removeMany.execute({ ids: [...selected] });
        }}
      />
    </>
  );
}
