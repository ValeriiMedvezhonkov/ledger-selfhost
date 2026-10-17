"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { format } from "date-fns";
import { addDaysISO, type ISODate } from "@/lib/date";
import type { Minor } from "@/lib/money";
import { goalFormSchema } from "@/lib/validations";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import {
  archiveGoal,
  contributeToGoal,
  createGoal,
  updateGoal,
} from "@/app/(app)/goals/actions";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton } from "@/components/ios/glass";
import { ActionRow } from "@/components/ios/list";
import { Segmented } from "@/components/ios/controls";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { IosAlert } from "@/components/ios/alert";
import { Symbol } from "@/components/ios/symbol";
import { goalLook } from "@/components/goals/ios/goal-look";
import {
  AmountField,
  CurrencyRow,
  DateSheet,
  FieldRow,
  MenuRow,
  RowInput,
  useMoneyInput,
} from "@/components/goals/ios/sheet-fields";
import { cn } from "@/lib/utils";

/** One goal as the card draws it; the projection is computed on the server. */
export interface GoalCard {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly currency: string;
  readonly targetMinor: Minor;
  readonly savedMinor: Minor;
  readonly targetDate: ISODate | null;
  readonly accountId: string | null;
  /** 0–100, clamped by projectGoal. */
  readonly percent: number;
  readonly remainingMinor: Minor;
  readonly achievedOn: ISODate | null;
  readonly projectedOn: ISODate | null;
}

interface GoalDraft {
  readonly id: string | null;
  readonly name: string;
  readonly target: string;
  readonly currency: string;
  readonly targetDate: ISODate | null;
  readonly accountId: string | null;
}

interface ContributionDraft {
  readonly goal: GoalCard;
  readonly amount: string;
  readonly occurredOn: ISODate;
  readonly withdraw: boolean;
}

interface Failure {
  readonly error: { readonly serverError?: string | undefined };
}

/**
 * Цели (boards EL02 / E02). A card per goal: its tile, a soft «Пополнить»
 * capsule, the saved amount against the target, a bar in the goal's colour
 * and one line of outlook — when the current pace gets there, or the month it
 * was reached. Tapping a card edits it; «Добавить цель» opens the same sheet
 * empty.
 */
export function GoalsScreen({
  goals,
  accounts,
  baseCurrency,
  today,
}: {
  readonly goals: readonly GoalCard[];
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly baseCurrency: string;
  readonly today: ISODate;
}) {
  const t = useTranslations("ios.goals");
  const tv = useTranslations("validation");
  const f = useFormats();
  const router = useRouter();
  const toInput = useMoneyInput();

  // Drafts outlive their sheet's open flag so the content stays put while the
  // sheet animates away, instead of blanking mid-dismiss.
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickingDeadline, setPickingDeadline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [contribution, setContribution] = useState<ContributionDraft | null>(null);
  const [contributing, setContributing] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);

  const failed = ({ error }: Failure) => {
    toast.error(error.serverError ?? t("failed"));
  };
  const saved = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setEditing(false);
      router.refresh();
    },
    onError: failed,
  });
  const create = useAction(createGoal, saved(t("added")));
  const update = useAction(updateGoal, saved(t("updated")));
  const archive = useAction(archiveGoal, {
    onSuccess: () => {
      toast.success(t("deleted"));
      setConfirmDelete(false);
      setEditing(false);
      router.refresh();
    },
    onError: failed,
  });
  const contribute = useAction(contributeToGoal, {
    onSuccess: () => {
      toast.success(t("contributed"));
      setContributing(false);
      router.refresh();
    },
    onError: failed,
  });

  const money = (minor: Minor, currency: string) =>
    minus(f.money(minor, currency, { noDecimals: true }));
  const monthYear = (value: ISODate, pattern: string) =>
    // date-fns' short Russian months carry a period («июн.»); the boards don't.
    format(new Date(`${value}T12:00:00`), pattern, { locale: f.calendar }).replace(".", "");

  const openEditor = (goal: GoalCard | null) => {
    setDraft(
      goal === null
        ? { id: null, name: "", target: "", currency: baseCurrency, targetDate: null, accountId: null }
        : {
            id: goal.id,
            name: goal.name,
            target: toInput(goal.targetMinor, goal.currency),
            currency: goal.currency,
            targetDate: goal.targetDate,
            accountId: goal.accountId,
          },
    );
    setEditing(true);
  };

  const openContribution = (goal: GoalCard) => {
    setContribution({ goal, amount: "", occurredOn: today, withdraw: false });
    setContributing(true);
  };

  const saveDraft = () => {
    if (draft === null) return;
    const values = {
      name: draft.name,
      target: draft.target,
      currency: draft.currency,
      targetDate: draft.targetDate,
      accountId: draft.accountId,
    };
    // Same schema the action parses with, so a missing name says so here
    // instead of round-tripping for a generic failure.
    const parsed = goalFormSchema.safeParse(values);
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? "";
      toast.error(tv.has(code) ? tv(code) : t("failed"));
      return;
    }
    if (draft.id === null) create.execute(parsed.data);
    else update.execute({ ...parsed.data, id: draft.id });
  };

  const saveContribution = () => {
    if (contribution === null) return;
    const amount = contribution.amount.trim();
    if (amount === "") return;
    contribute.execute({
      goalId: contribution.goal.id,
      amount: contribution.withdraw ? `-${amount.replace(/^-/, "")}` : amount,
      occurredOn: contribution.occurredOn,
    });
  };

  const yesterday = addDaysISO(today, -1);
  const dayLabel = (value: ISODate) =>
    value === today ? t("today") : value === yesterday ? t("yesterday") : f.date(value);
  const accountName = (id: string | null) =>
    accounts.find((a) => a.id === id)?.name ?? t("noAccount");

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: t("back") }} />

      <ScreenBody className="gap-3 pt-3">
        {goals.length === 0 && (
          <div className="inset-group flex flex-col items-center gap-2 px-6 py-7 text-center">
            <Symbol name="savings" size={44} className="text-label-3" />
            <p className="t-headline">{t("emptyTitle")}</p>
            <p className="t-subhead text-label-2">{t("emptyBody")}</p>
          </div>
        )}

        {goals.map((goal) => {
          const look = goalLook(goal);
          const reached = goal.achievedOn !== null || goal.savedMinor >= goal.targetMinor;
          // Rounded, but never to 100 % before the target is actually met.
          const percent = reached ? 100 : Math.min(99, Math.round(goal.percent));
          const percentLabel = `${String(percent)}%`;
          const outlook = reached
            ? goal.achievedOn !== null
              ? t("achieved", { date: monthYear(goal.achievedOn, "LLLL yyyy") })
              : t("achievedNoDate")
            : goal.projectedOn !== null
              ? t("projection", { date: monthYear(goal.projectedOn, "LLL yyyy") })
              : goal.targetDate !== null
                ? t("deadline", { date: f.date(goal.targetDate) })
                : goal.savedMinor <= 0
                  ? t("noPaceYet")
                  : null;
          return (
            <article key={goal.id} className="inset-group relative flex flex-col gap-3 p-4">
              {/*
                The whole card edits the goal. A covering button rather than a
                button wrapping the card, because «Пополнить» sits inside it
                and buttons cannot nest.
              */}
              <button
                type="button"
                aria-label={goal.name}
                onClick={() => {
                  openEditor(goal);
                }}
                className="press-row absolute inset-0 rounded-[26px]"
              />
              <div className="pointer-events-none flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
                  style={{ backgroundColor: look.color }}
                >
                  <Symbol name={look.icon} size={22} weight={600} />
                </span>
                <h2 className="t-headline line-clamp-2 min-w-0 flex-1">{goal.name}</h2>
                {reached ? (
                  <Symbol name="check_circle" size={26} weight={600} className="text-ios-green" />
                ) : (
                  <button
                    type="button"
                    aria-label={t("topUpTo", { name: goal.name })}
                    onClick={() => {
                      openContribution(goal);
                    }}
                    className="bg-tint-soft text-tint press pointer-events-auto relative h-8 shrink-0 rounded-full px-3.5 text-[15px] font-semibold tracking-[-0.013em]"
                  >
                    {t("topUp")}
                  </button>
                )}
              </div>
              <div className="pointer-events-none flex items-end justify-between gap-3">
                <p className="flex min-w-0 items-end gap-[5px]">
                  <span className="money text-[22px] leading-[28px] font-bold tracking-[-0.02em]">
                    {money(goal.savedMinor, goal.currency)}
                  </span>
                  <span className="money text-label-2 truncate pb-0.5 text-[15px] leading-5">
                    {t("of", { amount: money(goal.targetMinor, goal.currency) })}
                  </span>
                </p>
                <span className="money text-label-2 shrink-0 pb-0.5 text-[15px] leading-5 font-semibold">
                  {percentLabel}
                </span>
              </div>
              <span
                role="img"
                aria-label={t("progress", { name: goal.name, percent })}
                className="bg-ios-fill-3 pointer-events-none block h-[7px] w-full overflow-hidden rounded-full"
              >
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${String(percent)}%`, backgroundColor: look.color }}
                />
              </span>
              {outlook !== null && (
                <p
                  className={cn(
                    "t-footnote pointer-events-none",
                    reached ? "text-ios-green font-semibold" : "text-label-2",
                  )}
                >
                  {outlook}
                </p>
              )}
            </article>
          );
        })}

        <button
          type="button"
          onClick={() => {
            openEditor(null);
          }}
          className="inset-group press-row text-tint t-headline flex h-[52px] w-full items-center justify-center gap-[7px]"
        >
          <Symbol name="add" size={22} weight={600} />
          {t("add")}
        </button>
      </ScreenBody>

      {/* ------------------------------------------------ edit / new goal */}
      <Sheet
        open={editing}
        onOpenChange={setEditing}
        detent="medium"
        title={draft?.id === null ? t("newGoal") : t("editGoal")}
      >
        {draft !== null && (
          <>
            <SheetHeader
              title={draft.id === null ? t("newGoal") : t("editGoal")}
              onClose={() => {
                setEditing(false);
              }}
              trailing={
                <GlassButton
                  icon="check"
                  tinted
                  label={t("save")}
                  disabled={
                    draft.name.trim() === "" || draft.target.trim() === "" || create.isPending || update.isPending
                  }
                  onClick={saveDraft}
                />
              }
            />
            <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-4 pt-4 pb-8 overscroll-contain *:shrink-0">
              <AmountField
                label={t("target")}
                value={draft.target}
                currency={draft.currency}
                autoFocus={draft.id === null}
                onChange={(target) => {
                  setDraft({ ...draft, target });
                }}
              />
              <div className="flex flex-col gap-1.5">
                <div className="inset-group">
                  <FieldRow label={t("name")} htmlFor="goal-name">
                    <RowInput
                      id="goal-name"
                      value={draft.name}
                      placeholder={t("namePlaceholder")}
                      onChange={(name) => {
                        setDraft({ ...draft, name });
                      }}
                    />
                  </FieldRow>
                  <CurrencyRow
                    label={t("currency")}
                    value={draft.currency}
                    onChange={(currency) => {
                      setDraft({ ...draft, currency });
                    }}
                  />
                  <MenuRow
                    label={t("targetDate")}
                    value={draft.targetDate === null ? t("noDate") : f.date(draft.targetDate)}
                    entries={[
                      {
                        key: "none",
                        label: t("noDate"),
                        checked: draft.targetDate === null,
                        onSelect: () => {
                          setDraft({ ...draft, targetDate: null });
                        },
                      },
                      {
                        key: "pick",
                        label: draft.targetDate === null ? t("pickDate") : f.date(draft.targetDate),
                        checked: draft.targetDate !== null,
                        icon: "date_range",
                        onSelect: () => {
                          setPickingDeadline(true);
                        },
                      },
                    ]}
                  />
                  {accounts.length > 0 && (
                    <MenuRow
                      label={t("account")}
                      value={accountName(draft.accountId)}
                      entries={[
                        {
                          key: "none",
                          label: t("noAccount"),
                          checked: draft.accountId === null,
                          onSelect: () => {
                            setDraft({ ...draft, accountId: null });
                          },
                        },
                        ...accounts.map((a) => ({
                          key: a.id,
                          label: a.name,
                          checked: a.id === draft.accountId,
                          onSelect: () => {
                            setDraft({ ...draft, accountId: a.id });
                          },
                        })),
                      ]}
                    />
                  )}
                </div>
                {accounts.length > 0 && (
                  <p className="t-footnote text-label-2 px-4">{t("accountHint")}</p>
                )}
              </div>
              {draft.id !== null && (
                <ActionRow
                  destructive
                  onClick={() => {
                    setConfirmDelete(true);
                  }}
                >
                  {t("delete")}
                </ActionRow>
              )}
            </div>
          </>
        )}
      </Sheet>

      <DateSheet
        open={pickingDeadline}
        onOpenChange={setPickingDeadline}
        title={t("targetDate")}
        value={draft?.targetDate ?? null}
        onPick={(targetDate) => {
          if (draft !== null) setDraft({ ...draft, targetDate });
        }}
      />

      <IosAlert
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteTitle", { name: draft?.name ?? "" })}
        message={t("deleteMessage")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteConfirm")}
        pending={archive.isPending}
        onConfirm={() => {
          if (draft?.id != null) archive.execute({ id: draft.id });
        }}
      />

      {/* ------------------------------------------------- contribution */}
      <Sheet
        open={contributing}
        onOpenChange={setContributing}
        detent="medium"
        title={t("contributeTitle")}
      >
        {contribution !== null && (
          <>
            <SheetHeader
              title={contribution.goal.name}
              onClose={() => {
                setContributing(false);
              }}
              trailing={
                <GlassButton
                  icon="check"
                  tinted
                  label={t("save")}
                  disabled={contribution.amount.trim() === "" || contribute.isPending}
                  onClick={saveContribution}
                />
              }
            />
            <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
              <Segmented
                label={t("contributeTitle")}
                value={contribution.withdraw ? "out" : "in"}
                onChange={(value) => {
                  setContribution({ ...contribution, withdraw: value === "out" });
                }}
                options={[
                  { value: "in", label: t("topUp") },
                  { value: "out", label: t("withdraw") },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <AmountField
                  label={t("amount")}
                  value={contribution.amount}
                  currency={contribution.goal.currency}
                  autoFocus
                  onChange={(amount) => {
                    setContribution({ ...contribution, amount });
                  }}
                />
                <p className="t-footnote text-label-2 px-4">
                  {contribution.goal.remainingMinor > 0
                    ? t("remaining", {
                        amount: money(contribution.goal.remainingMinor, contribution.goal.currency),
                      })
                    : t("reachedAlready")}
                </p>
              </div>
              <div className="inset-group">
                <MenuRow
                  label={t("date")}
                  value={dayLabel(contribution.occurredOn)}
                  entries={[
                    {
                      key: "today",
                      label: t("today"),
                      checked: contribution.occurredOn === today,
                      onSelect: () => {
                        setContribution({ ...contribution, occurredOn: today });
                      },
                    },
                    {
                      key: "yesterday",
                      label: t("yesterday"),
                      checked: contribution.occurredOn === yesterday,
                      onSelect: () => {
                        setContribution({ ...contribution, occurredOn: yesterday });
                      },
                    },
                    "separator",
                    {
                      key: "pick",
                      label: t("pickDate"),
                      icon: "date_range",
                      onSelect: () => {
                        setPickingDay(true);
                      },
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </Sheet>

      <DateSheet
        open={pickingDay}
        onOpenChange={setPickingDay}
        title={t("date")}
        value={contribution?.occurredOn ?? today}
        onPick={(occurredOn) => {
          if (contribution !== null) setContribution({ ...contribution, occurredOn });
        }}
      />
    </>
  );
}
