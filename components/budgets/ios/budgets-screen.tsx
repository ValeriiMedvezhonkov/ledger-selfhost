"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { format } from "date-fns";
import { addMonthsISO, type ISODate } from "@/lib/date";
import type { BudgetWithSpend } from "@/lib/queries";
import { negateMinor, type Minor } from "@/lib/money";
import { categorySymbol } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import {
  copyBudgets,
  createBudget,
  deleteBudget,
  updateBudget,
} from "@/app/(app)/budgets/actions";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton, GlassGroup } from "@/components/ios/glass";
import { ProminentButton } from "@/components/ios/glass";
import { Ring } from "@/components/ios/controls";
import { SectionHeader } from "@/components/ios/list";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import { useKeypadInput } from "@/components/ios/keypad";
import type { PickerCategory } from "@/components/transactions/ios/category-picker-sheet";
import { cn } from "@/lib/utils";

interface Editing {
  readonly id: string | null;
  readonly categoryId: string | null;
  readonly limit: string;
}

/**
 * Бюджеты (board L08). A month stepper in a glass capsule, the month's spend
 * against the sum of limits with a stacked bar by category, then each budget
 * as a ring around its category glyph with a plain-language verdict:
 * «252 € осталось», «12 € сверх», or «оплачено» for a fixed cost (a category
 * with an active recurring rule) that has been paid in full.
 */
export function BudgetsScreen({
  budgets,
  periodStart,
  isFuture,
  daysLeft,
  canCopyPrevious,
  currency,
  categories,
}: {
  readonly budgets: readonly BudgetWithSpend[];
  readonly periodStart: ISODate;
  readonly isFuture: boolean;
  readonly daysLeft: number | null;
  readonly canCopyPrevious: boolean;
  readonly currency: string;
  readonly categories: readonly PickerCategory[];
}) {
  const t = useTranslations("ios.budgets");
  const f = useFormats();
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editMode, setEditMode] = useState(false);

  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";
  const ok = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setEditing(null);
      router.refresh();
    },
    onError: ({ error }: { error: { serverError?: string | undefined } }) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });
  const create = useAction(createBudget, ok(t("saved")));
  const update = useAction(updateBudget, ok(t("saved")));
  const remove = useAction(deleteBudget, ok(t("deleted")));
  const copy = useAction(copyBudgets, ok(t("copied")));

  const limit = budgets.reduce((sum, b) => sum + b.limitMinor, 0) as Minor;
  const spent = budgets.reduce((sum, b) => sum + b.spentMinor, 0) as Minor;
  const share = limit > 0 ? spent / limit : 0;
  const sharePercent = `${Math.round(share * 100)}%`;
  const sorted = [...budgets].sort((a, b) => b.spentMinor - a.spentMinor);
  const month = format(new Date(`${periodStart}T12:00:00`), "LLLL", {
    locale: f.calendar,
  });
  const monthTitle = month.charAt(0).toUpperCase() + month.slice(1);

  const go = (delta: number) => {
    const next = addMonthsISO(periodStart, delta).slice(0, 7);
    router.replace(`/budgets?month=${next}`, { scroll: false });
  };

  const money = (minor: Minor, noDecimals = false) =>
    minus(f.money(minor, currency, { noDecimals }));
  const toInput = (minor: Minor) => {
    const whole = Math.floor(minor / 100);
    const cents = minor % 100;
    return cents === 0
      ? String(whole)
      : `${whole}${separator}${String(cents).padStart(2, "0")}`;
  };

  const used = new Set(budgets.map((b) => b.categoryId));
  const freeCategories = categories.filter(
    (c) => !used.has(c.id) || c.id === editing?.categoryId,
  );

  return (
    <>
      <NavBar
        large
        title={t("title")}
        subtitle={
          daysLeft !== null
            ? `${monthTitle} · ${t("daysLeft", { count: daysLeft })}`
            : isFuture
              ? t("planned", { month: monthTitle })
              : t("past", { month: monthTitle })
        }
        inlineSubtitle={monthTitle}
        trailing={
          <div className="flex items-center gap-2.5">
            {/* Month stepper: the month itself is named in the subtitle. */}
            <GlassGroup
              items={[
                {
                  icon: "chevron_left",
                  label: t("previous"),
                  onClick: () => {
                    go(-1);
                  },
                },
                {
                  icon: "chevron_right",
                  label: t("next"),
                  onClick: () => {
                    go(1);
                  },
                },
              ]}
            />
            <GlassButton
              icon="add"
              label={t("add")}
              onClick={() => {
                setEditing({ id: null, categoryId: null, limit: "" });
              }}
            />
          </div>
        }
      />

      <ScreenBody className="gap-5 pt-3">
        {budgets.length === 0 ? (
          <div className="inset-group flex flex-col items-center gap-3 p-6 text-center">
            <Symbol name="donut_large" size={44} className="text-label-3" />
            <p className="t-headline">{t("emptyTitle")}</p>
            <p className="t-subhead text-label-2">{t("emptyBody")}</p>
            {canCopyPrevious && (
              <ProminentButton
                pending={copy.isPending}
                onClick={() => {
                  copy.execute({
                    fromPeriod: addMonthsISO(periodStart, -1),
                    toPeriod: periodStart,
                  });
                }}
              >
                {t("copyPrevious")}
              </ProminentButton>
            )}
          </div>
        ) : (
          <section className="inset-group flex flex-col gap-3.5 p-[18px]">
            <div className="flex flex-col gap-0.5">
              <p className="t-subhead text-label-2">
                {t("spentOf", { limit: money(limit, true) })}
              </p>
              <p className="flex items-end gap-2">
                <span className="money text-[34px] leading-[41px] font-bold tracking-[-0.03em]">
                  {money(spent)}
                </span>
                <span
                  className={cn(
                    "t-headline pb-1",
                    share > 1 ? "text-ios-red" : "text-ios-green",
                  )}
                >
                  {sharePercent}
                </span>
              </p>
            </div>
            <span className="bg-ios-fill-3 flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full">
              {sorted.map((budget) => (
                <span
                  key={budget.id}
                  className="h-full"
                  style={{
                    width: `${(budget.spentMinor / Math.max(limit, spent, 1)) * 100}%`,
                    backgroundColor: budget.categoryColor,
                  }}
                />
              ))}
            </span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {sorted.slice(0, 4).map((budget) => (
                <span
                  key={budget.id}
                  className="text-label-2 flex items-center gap-1.5 text-[12px]"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: budget.categoryColor }}
                  />
                  {budget.categoryName}
                </span>
              ))}
            </div>
          </section>
        )}

        {budgets.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionHeader
              title={t("byCategory")}
              action={{
                label: editMode ? t("done") : t("edit"),
                onClick: () => {
                  setEditMode((value) => !value);
                },
              }}
            />
            <div className="inset-group">
              {[...budgets]
                .sort((a, b) => a.categoryName.localeCompare(b.categoryName))
                .map((budget) => {
                  const over = budget.spentMinor > budget.limitMinor;
                  const left = (budget.limitMinor - budget.spentMinor) as Minor;
                  const verdict =
                    budget.isFixed &&
                    budget.spentMinor >= budget.limitMinor &&
                    !over
                      ? t("paid")
                      : over
                        ? t("over", { amount: money(negateMinor(left), true) })
                        : t("left", { amount: money(left, true) });
                  return (
                    <div key={budget.id} className="flex items-center">
                      {editMode && (
                        <button
                          type="button"
                          aria-label={t("delete")}
                          onClick={() => {
                            remove.execute({ id: budget.id });
                          }}
                          className="text-ios-red press ml-4 grid size-7 place-items-center"
                        >
                          <Symbol name="delete" size={22} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({
                            id: budget.id,
                            categoryId: budget.categoryId,
                            limit: toInput(budget.limitMinor),
                          });
                        }}
                        className="press-row flex min-h-[66px] min-w-0 flex-1 items-center gap-3.5 pl-4 text-left"
                      >
                        <Ring
                          value={
                            budget.spentMinor / Math.max(1, budget.limitMinor)
                          }
                          size={38}
                          stroke={4}
                          color={over ? "var(--ios-red)" : budget.categoryColor}
                        >
                          <Symbol
                            name={categorySymbol(
                              budget.categoryIcon,
                              budget.categorySlug,
                            )}
                            size={17}
                            weight={600}
                            style={{ color: budget.categoryColor }}
                          />
                        </Ring>
                        <span className="row-sep flex min-h-[66px] min-w-0 flex-1 items-center gap-2 pr-4">
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="t-headline truncate">
                              {budget.categoryName}
                            </span>
                            <span className="text-label-2 text-[14px]">
                              {t("of", {
                                spent: money(budget.spentMinor, true),
                                limit: money(budget.limitMinor, true),
                              })}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "t-subhead shrink-0 font-medium",
                              over ? "text-ios-red" : "text-label-2",
                            )}
                          >
                            {verdict}
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </ScreenBody>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        detent="medium"
        title={editing?.id === null ? t("new") : t("editOne")}
      >
        {editing !== null && (
          <>
            <SheetHeader
              title={editing.id === null ? t("new") : t("editOne")}
              onClose={() => {
                setEditing(null);
              }}
              trailing={
                <GlassButton
                  icon="check"
                  tinted
                  label={t("save")}
                  disabled={editing.categoryId === null || editing.limit === ""}
                  onClick={() => {
                    if (editing.categoryId === null) return;
                    const values = {
                      categoryId: editing.categoryId,
                      periodStart,
                      limit: editing.limit,
                    };
                    if (editing.id === null) create.execute(values);
                    else update.execute({ ...values, id: editing.id });
                  }}
                />
              }
            />
            <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
              {editing.id === null && (
                <div className="grid max-h-[30dvh] grid-cols-4 gap-x-1 gap-y-3 overflow-y-auto">
                  {freeCategories.map((category) => {
                    const selected = editing.categoryId === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          setEditing({ ...editing, categoryId: category.id });
                        }}
                        className="press flex flex-col items-center gap-1"
                      >
                        <span
                          className={cn(
                            "grid size-14 place-items-center rounded-full border-[2.5px]",
                            !selected && "border-transparent",
                          )}
                          style={
                            selected
                              ? { borderColor: category.color }
                              : undefined
                          }
                        >
                          <span
                            className="grid size-[46px] place-items-center rounded-full text-white"
                            style={{ backgroundColor: category.color }}
                          >
                            <Symbol
                              name={categorySymbol(
                                category.icon,
                                category.slug,
                              )}
                              size={24}
                              weight={600}
                            />
                          </span>
                        </span>
                        <span
                          className={cn(
                            "t-caption w-full truncate text-center",
                            selected ? "font-semibold" : "text-label-2",
                          )}
                        >
                          {category.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <LimitInput
                key={editing.id ?? "new"}
                label={t("limit")}
                value={editing.limit}
                currency={currency}
                onChange={(limit) => {
                  setEditing({ ...editing, limit });
                }}
              />
              {editing.id !== null && (
                <button
                  type="button"
                  onClick={() => {
                    if (editing.id !== null) remove.execute({ id: editing.id });
                  }}
                  className="inset-group t-body text-ios-red h-[52px]"
                >
                  {t("delete")}
                </button>
              )}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/**
 * «Лимит в месяц» on the in-app keypad (the same one Новая запись uses), so
 * the system keyboard never slides up over the sheet. Active from the start:
 * the limit is what this sheet is for.
 */
function LimitInput({
  label,
  value,
  currency,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly currency: string;
  readonly onChange: (value: string) => void;
}) {
  const input = useKeypadInput({ value, onChange, label, autoFocus: true });
  const symbol =
    new Intl.NumberFormat(undefined, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;
  return (
    <>
      <div className="bg-ios-card flex h-[60px] items-center gap-2 rounded-[18px] px-4">
        <span className="t-body text-label-2 shrink-0">{label}</span>
        {input.display("text-[28px] font-bold tracking-[-0.02em]")}
        <span className="text-label-2 shrink-0 text-[22px] font-semibold">
          {symbol}
        </span>
      </div>
      {input.keypad !== null && (
        <div className="-mx-2.5 [&>div]:bg-transparent">{input.keypad}</div>
      )}
    </>
  );
}
