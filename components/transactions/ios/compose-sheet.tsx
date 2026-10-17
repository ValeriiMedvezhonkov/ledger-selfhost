"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { format } from "date-fns";
import { categorySymbol } from "@/lib/symbols";
import { todayISO, toISODate, type ISODate } from "@/lib/date";
import { SPLIT_PAID_BY, type TransactionFormValues } from "@/lib/validations";
import type { QuickCategory, QuickPick } from "@/lib/quick-picks";
import type { Member } from "@/lib/queries";
import { useFormats } from "@/hooks/use-formats";
import {
  createTransaction,
  updateTransaction,
} from "@/app/(app)/transactions/actions";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassButton } from "@/components/ios/glass";
import { MemberAvatar, Segmented } from "@/components/ios/controls";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import { SymbolTile } from "@/components/ios/list";
import { SheetCalendar } from "@/components/ios/sheet-calendar";
import { Keypad, pressKey } from "@/components/ios/keypad";
import { CategoryPickerSheet } from "@/components/transactions/ios/category-picker-sheet";
import { cn } from "@/lib/utils";

export interface ComposeOptions {
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
  }[];
  readonly categories: readonly QuickCategory[];
  readonly members: readonly Member[];
  readonly baseCurrency: string;
  readonly currentUserId: string;
  readonly quick: readonly QuickPick[];
  readonly defaultAccountId: string | null;
}

export interface ComposeInitial {
  readonly id: string;
  readonly type: "income" | "expense";
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly paidByUserId: string;
  readonly amount: string;
  readonly currency: string;
  readonly occurredOn: string;
  readonly merchant: string | null;
  readonly note: string | null;
}

type Kind = "expense" | "income" | "transfer";

/* ----------------------------------------------------------------- sheet */

/**
 * Новая запись (board L05): the entry sheet the «+» button opens.
 *
 * Amount first and huge, typed on an in-sheet keypad (no system keyboard
 * sliding the sheet around); then who paid — either partner or «Пополам»,
 * which the server books as two halves; then the category as round tiles,
 * the quick picks first; then account, date, merchant and note as grouped
 * rows. The tinted check in the header saves, like a native confirm button.
 */
export function ComposeSheet({
  open,
  onOpenChange,
  options,
  initial,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly options: ComposeOptions | null;
  readonly initial: ComposeInitial | null;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("ios.compose");
  const locale = useLocale();
  const f = useFormats();
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";

  const [kind, setKind] = useState<Kind>("expense");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [date, setDate] = useState<ISODate>(todayISO(new Date()));
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [allCategories, setAllCategories] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const [typing, setTyping] = useState(false);
  const seeded = useRef<string | null>(null);

  // Seed the draft each time the sheet opens (fresh, or from the edited row).
  useEffect(() => {
    if (!open || options === null) return;
    const key = initial?.id ?? "new";
    if (seeded.current === key) return;
    seeded.current = key;
    setKind(initial?.type ?? "expense");
    setAmount(initial?.amount ?? "");
    setPaidBy(initial?.paidByUserId ?? options.currentUserId);
    setCategoryId(initial?.categoryId ?? null);
    setAccountId(
      initial?.accountId ??
        options.defaultAccountId ??
        options.accounts[0]?.id ??
        "",
    );
    setToAccountId(
      options.accounts.find((a) => a.id !== (options.defaultAccountId ?? ""))
        ?.id ?? "",
    );
    setDate(initial?.occurredOn ?? todayISO(new Date()));
    setMerchant(initial?.merchant ?? "");
    setNote(initial?.note ?? "");
  }, [open, options, initial]);

  useEffect(() => {
    if (!open) seeded.current = null;
  }, [open]);

  const done = {
    onSuccess: () => {
      toast.success(initial === null ? t("saved") : t("updated"));
      onOpenChange(false);
      onSaved();
    },
    onError: ({ error }: { error: { serverError?: string | undefined } }) => {
      toast.error(error.serverError ?? t("checkFields"));
    },
  };
  const create = useAction(createTransaction, done);
  const update = useAction(updateTransaction, done);
  const pending = create.isPending || update.isPending;

  const currency =
    options?.accounts.find((a) => a.id === accountId)?.currency ??
    options?.baseCurrency ??
    "EUR";
  const symbol =
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency;

  const press = (key: string) => {
    setAmount((value) => pressKey(value, key, separator));
  };

  const categories = useMemo(() => {
    if (options === null) return [];
    const wanted = kind === "income" ? "income" : "expense";
    const ofKind = options.categories.filter((c) => c.kind === wanted);
    const quickIds = options.quick.map((q) => q.categoryId);
    const ordered = [
      ...quickIds.flatMap((id) => ofKind.filter((c) => c.id === id)),
      ...ofKind.filter((c) => !quickIds.includes(c.id)),
    ];
    // The chosen one is always visible, even if it is not a quick pick.
    const chosen = ordered.find((c) => c.id === categoryId);
    const head = ordered.slice(0, 7);
    return chosen !== undefined && !head.includes(chosen)
      ? [chosen, ...head.slice(0, 6)]
      : head;
  }, [options, kind, categoryId]);

  const display = `${amount === "" ? `0${separator}00` : amount} ${symbol}`;

  const canSave =
    amount !== "" &&
    Number(amount.replace(separator, ".")) > 0 &&
    accountId !== "" &&
    (kind === "transfer"
      ? toAccountId !== "" && toAccountId !== accountId
      : categoryId !== null);

  const save = () => {
    if (!canSave || options === null) return;
    const values: TransactionFormValues = {
      type: kind,
      accountId,
      ...(kind === "transfer" ? { toAccountId } : {}),
      categoryId: kind === "transfer" ? null : categoryId,
      paidByUserId: paidBy,
      amount,
      currency: currency as TransactionFormValues["currency"],
      occurredOn: date,
      merchant: merchant.trim() === "" ? null : merchant.trim(),
      note: note.trim() === "" ? null : note.trim(),
    };
    if (initial === null) create.execute(values);
    else update.execute({ id: initial.id, values });
  };

  const today = todayISO(new Date());
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  })();
  const dateLabel =
    date === today
      ? t("todayLabel", {
          date: format(new Date(`${date}T12:00:00`), "d MMM", {
            locale: f.calendar,
          }),
        })
      : date === yesterday
        ? t("yesterdayLabel")
        : f.date(date);
  const accountName =
    options?.accounts.find((a) => a.id === accountId)?.name ?? "";
  const toAccountName =
    options?.accounts.find((a) => a.id === toAccountId)?.name ?? "";

  const row = (
    icon: Parameters<typeof SymbolTile>[0]["icon"],
    color: string,
    label: string,
    control: ReactNode,
  ) => (
    <div className="flex min-h-[52px] items-center gap-3.5 pl-4">
      <SymbolTile icon={icon} color={color} />
      <div className="row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-2 pr-4">
        <span className="t-body shrink-0">{label}</span>
        <div className="flex min-w-0 flex-1 justify-end">{control}</div>
      </div>
    </div>
  );

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        // Sized to its content like every other sheet (Бюджет, Фильтры),
        // not the full-height card: the screen stays visible above it.
        detent="medium"
        title={initial === null ? t("title") : t("editTitle")}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader
            title={initial === null ? t("title") : t("editTitle")}
            onClose={() => {
              onOpenChange(false);
            }}
            trailing={
              <GlassButton
                icon="check"
                label={t("save")}
                tinted
                disabled={!canSave || pending}
                onClick={save}
              />
            }
          />

          {options === null ? (
            <div className="grid flex-1 place-items-center">
              <span className="t-subhead text-label-2">{t("loading")}</span>
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-3 *:shrink-0">
                {initial === null && (
                  <Segmented<Kind>
                    label={t("kind")}
                    value={kind}
                    onChange={(next) => {
                      setKind(next);
                      setCategoryId(null);
                    }}
                    options={[
                      { value: "expense", label: t("expense") },
                      { value: "income", label: t("income") },
                      { value: "transfer", label: t("transfer") },
                    ]}
                  />
                )}

                <button
                  type="button"
                  onClick={() => {
                    setTyping(false);
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                  className="flex items-center justify-center gap-0.5 py-1"
                  aria-label={t("amount")}
                >
                  <span
                    className={cn(
                      "money text-[64px] leading-[72px] font-bold tracking-[-0.03em] [@media(max-height:760px)]:text-[46px] [@media(max-height:760px)]:leading-[54px]",
                      amount === "" && "text-label-3",
                    )}
                  >
                    {display}
                  </span>
                  {!typing && (
                    <span className="bg-tint h-14 w-[3px] animate-pulse rounded-full" />
                  )}
                </button>

                {kind !== "transfer" && (
                  <div className="-mx-4 flex justify-center gap-2 overflow-x-auto px-4">
                    {[
                      ...options.members.map((m) => ({
                        id: m.id,
                        name: m.name,
                        color: m.color,
                      })),
                      ...(options.members.length === 2
                        ? [
                            {
                              id: SPLIT_PAID_BY,
                              name: t("split"),
                              color: "var(--ios-gray)",
                            },
                          ]
                        : []),
                    ].map((who) => {
                      const selected = paidBy === who.id;
                      return (
                        <button
                          key={who.id}
                          type="button"
                          onClick={() => {
                            setPaidBy(who.id);
                          }}
                          className={cn(
                            "press flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-[14px] tracking-[-0.01em]",
                            selected
                              ? "bg-tint-soft text-tint font-semibold shadow-[inset_0_0_0_1.5px_var(--ios-tint)]"
                              : "bg-ios-card font-medium shadow-[inset_0_0_0_0.5px_var(--ios-sep)]",
                          )}
                        >
                          {who.id === SPLIT_PAID_BY ? (
                            <span className="bg-ios-gray grid size-6 place-items-center rounded-full text-white">
                              <Symbol name="group" size={15} weight={600} />
                            </span>
                          ) : (
                            <MemberAvatar
                              name={who.name}
                              color={who.color}
                              size={24}
                            />
                          )}
                          {who.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {kind !== "transfer" && (
                  <div className="-mx-4 flex gap-1 overflow-x-auto px-4">
                    {categories.map((category) => {
                      const selected = category.id === categoryId;
                      return (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => {
                            setCategoryId(category.id);
                          }}
                          className="press flex w-[72px] shrink-0 flex-col items-center gap-1.5"
                        >
                          <span
                            className={cn(
                              "grid size-[60px] place-items-center rounded-full border-[2.5px]",
                              !selected && "border-transparent",
                            )}
                            style={
                              selected
                                ? { borderColor: category.color }
                                : undefined
                            }
                          >
                            <span
                              className="grid size-[50px] place-items-center rounded-full text-white"
                              style={{ backgroundColor: category.color }}
                            >
                              <Symbol
                                name={categorySymbol(
                                  category.icon,
                                  category.slug,
                                )}
                                size={26}
                                weight={600}
                              />
                            </span>
                          </span>
                          <span
                            className={cn(
                              "t-caption w-full truncate text-center",
                              selected
                                ? "font-semibold"
                                : "text-label-2 font-medium",
                            )}
                          >
                            {category.name}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setAllCategories(true);
                      }}
                      className="press flex w-[72px] shrink-0 flex-col items-center gap-1.5"
                    >
                      <span className="bg-ios-fill-3 grid size-[60px] place-items-center rounded-full">
                        <Symbol name="more_horiz" size={26} />
                      </span>
                      <span className="t-caption text-label-2 font-medium">
                        {t("allCategories")}
                      </span>
                    </button>
                  </div>
                )}

                <div className="inset-group">
                  {row(
                    "account_balance",
                    "var(--ios-blue)",
                    kind === "transfer" ? t("from") : t("account"),
                    <GlassMenu
                      label={t("account")}
                      trigger={
                        <button
                          type="button"
                          className="t-body text-label-2 flex min-w-0 items-center gap-0.5"
                        >
                          <span className="truncate">{accountName}</span>
                          <Symbol
                            name="chevron_right"
                            size={20}
                            weight={600}
                            className="text-label-3"
                          />
                        </button>
                      }
                      entries={options.accounts.map((a) => ({
                        key: a.id,
                        label: a.name,
                        checked: a.id === accountId,
                        onSelect: () => {
                          setAccountId(a.id);
                        },
                      }))}
                    />,
                  )}
                  {kind === "transfer" &&
                    row(
                      "swap_horiz",
                      "var(--ios-teal)",
                      t("to"),
                      <GlassMenu
                        label={t("to")}
                        trigger={
                          <button
                            type="button"
                            className="t-body text-label-2 flex min-w-0 items-center gap-0.5"
                          >
                            <span className="truncate">{toAccountName}</span>
                            <Symbol
                              name="chevron_right"
                              size={20}
                              weight={600}
                              className="text-label-3"
                            />
                          </button>
                        }
                        entries={options.accounts
                          .filter((a) => a.id !== accountId)
                          .map((a) => ({
                            key: a.id,
                            label: a.name,
                            checked: a.id === toAccountId,
                            onSelect: () => {
                              setToAccountId(a.id);
                            },
                          }))}
                      />,
                    )}
                  {row(
                    "calendar_today",
                    "var(--ios-red)",
                    t("date"),
                    <GlassMenu
                      label={t("date")}
                      trigger={
                        <button
                          type="button"
                          className="t-body text-label-2 flex min-w-0 items-center gap-0.5"
                        >
                          <span className="truncate">{dateLabel}</span>
                          <Symbol
                            name="chevron_right"
                            size={20}
                            weight={600}
                            className="text-label-3"
                          />
                        </button>
                      }
                      entries={[
                        {
                          key: "today",
                          label: t("today"),
                          checked: date === today,
                          onSelect: () => {
                            setDate(today);
                          },
                        },
                        {
                          key: "yesterday",
                          label: t("yesterday"),
                          checked: date === yesterday,
                          onSelect: () => {
                            setDate(yesterday);
                          },
                        },
                        "separator",
                        {
                          key: "pick",
                          label: t("pickDate"),
                          icon: "date_range",
                          onSelect: () => {
                            setPickingDate(true);
                          },
                        },
                      ]}
                    />,
                  )}
                  {kind !== "transfer" &&
                    row(
                      "storefront",
                      "var(--ios-orange)",
                      t("merchant"),
                      <input
                        value={merchant}
                        onChange={(event) => {
                          setMerchant(event.target.value);
                        }}
                        onFocus={() => {
                          setTyping(true);
                        }}
                        onBlur={() => {
                          setTyping(false);
                        }}
                        placeholder={t("merchantPlaceholder")}
                        aria-label={t("merchant")}
                        className="t-body text-label-2 placeholder:text-label-3 min-w-0 flex-1 bg-transparent text-right outline-none"
                      />,
                    )}
                  {row(
                    "notes",
                    "var(--ios-yellow)",
                    t("note"),
                    <input
                      value={note}
                      onChange={(event) => {
                        setNote(event.target.value);
                      }}
                      onFocus={() => {
                        setTyping(true);
                      }}
                      onBlur={() => {
                        setTyping(false);
                      }}
                      placeholder={t("notePlaceholder")}
                      aria-label={t("note")}
                      className="t-body text-label-2 placeholder:text-label-3 min-w-0 flex-1 bg-transparent text-right outline-none"
                    />,
                  )}
                </div>
              </div>
              {/* The keypad sits on the sheet's glass as in Бюджет's limit sheet. */}
              {!typing && (
                <div className="px-4 pb-6">
                  <div className="-mx-2.5 [&>div]:bg-transparent">
                    <Keypad
                      onKey={press}
                      separator={separator}
                      label={t("keypad")}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Sheet>

      {options !== null && (
        <CategoryPickerSheet
          open={allCategories}
          onOpenChange={setAllCategories}
          categories={options.categories}
          kind={kind === "income" ? "income" : "expense"}
          selectedId={categoryId}
          onPick={setCategoryId}
        />
      )}

      <Sheet
        open={pickingDate}
        onOpenChange={setPickingDate}
        detent="medium"
        title={t("pickDate")}
      >
        <SheetHeader
          title={t("pickDate")}
          onClose={() => {
            setPickingDate(false);
          }}
        />
        <div className="px-4 pt-2 pb-8">
          <SheetCalendar
            mode="single"
            selected={new Date(`${date}T12:00:00`)}
            onSelect={(picked) => {
              if (picked !== undefined) setDate(toISODate(picked));
              setPickingDate(false);
            }}
            locale={f.calendar}
          />
        </div>
      </Sheet>
    </>
  );
}
