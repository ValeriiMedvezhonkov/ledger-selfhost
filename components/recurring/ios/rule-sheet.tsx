"use client";

import { useKeypadInput } from "@/components/ios/keypad";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  createRecurring,
  deleteRecurring,
  skipNextRecurring,
  toggleRecurring,
  updateRecurring,
} from "@/app/(app)/recurring/actions";
import type { RecurringWithNames } from "@/lib/queries";
import type { ISODate } from "@/lib/date";
import type { RecurringFormValues } from "@/lib/validations";
import {
  SUPPORTED_CURRENCIES,
  absMinor,
  minorToInputString,
} from "@/lib/money";
import { categorySymbol } from "@/lib/symbols";
import { useFormats } from "@/hooks/use-formats";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassButton } from "@/components/ios/glass";
import { MemberAvatar, Segmented, Switch } from "@/components/ios/controls";
import { ActionRow, SymbolTile } from "@/components/ios/list";
import { GlassMenu } from "@/components/ios/menu";
import { IosAlert } from "@/components/ios/alert";
import { Symbol } from "@/components/ios/symbol";
import {
  CategoryPickerSheet,
  type PickerCategory,
} from "@/components/transactions/ios/category-picker-sheet";
import {
  useSchedule,
  type Frequency,
} from "@/components/recurring/ios/schedule";
import { cn } from "@/lib/utils";

export interface RuleAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly isDefault: boolean;
}

export interface RuleMember {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

type Currency = RecurringFormValues["currency"];

function isCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** One grouped-table row: label on the left, the control on the right. */
function Field({
  label,
  children,
  className,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "row-sep flex min-h-[52px] items-center gap-3 pr-4 pl-4",
        className,
      )}
    >
      <span className="t-body shrink-0">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {children}
      </span>
    </div>
  );
}

/** The value side of a picker row: current choice and the ↕ affordance. */
function MenuTrigger({ children }: { readonly children: ReactNode }) {
  return (
    <button
      type="button"
      className="t-body text-label-2 flex min-w-0 items-center gap-0.5"
    >
      <span className="truncate">{children}</span>
      <Symbol
        name="unfold_more"
        size={18}
        weight={600}
        className="text-label-3"
      />
    </button>
  );
}

/**
 * The rule editor (a large sheet). Everything the old form had — kind, name,
 * amount and currency, account, category, payer, frequency with an interval
 * stepper, start and optional end, note — laid out as grouped rows, with the
 * schedule read back in words under the frequency so «каждые 2 · месяц»
 * becomes «раз в 2 месяца, 1-го числа» before it is saved. Existing rules add
 * the pause switch, «skip the next one» and delete.
 */
export function RuleSheet({
  open,
  onOpenChange,
  formKey,
  rule,
  ...rest
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly formKey: number;
  readonly rule: RecurringWithNames | null;
  readonly accounts: readonly RuleAccount[];
  readonly categories: readonly PickerCategory[];
  readonly members: readonly RuleMember[];
  readonly currentUserId: string;
  readonly baseCurrency: string;
  readonly today: ISODate;
}) {
  const t = useTranslations("ios.recurring");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={rule === null ? t("new") : t("edit")}
    >
      <RuleForm
        key={formKey}
        rule={rule}
        {...rest}
        onClose={() => {
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}

function RuleForm({
  rule,
  accounts,
  categories,
  members,
  currentUserId,
  baseCurrency,
  today,
  onClose,
}: {
  readonly rule: RecurringWithNames | null;
  readonly accounts: readonly RuleAccount[];
  readonly categories: readonly PickerCategory[];
  readonly members: readonly RuleMember[];
  readonly currentUserId: string;
  readonly baseCurrency: string;
  readonly today: ISODate;
  readonly onClose: () => void;
}) {
  const t = useTranslations("ios.recurring");
  const f = useFormats();
  const router = useRouter();
  const schedule = useSchedule();
  const locale = useLocale();
  // minorToInputString writes a dot; a Russian keypad types a comma, so the
  // prefilled amount uses the interface's separator (parseMoneyInput reads both).
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";

  const fallbackAccount = accounts.find((a) => a.isDefault) ?? accounts[0];
  const [type, setType] = useState<"income" | "expense">(
    rule?.type === "income" ? "income" : "expense",
  );
  const [name, setName] = useState(rule?.name ?? "");
  const [amount, setAmount] = useState(
    rule === null
      ? ""
      : minorToInputString(absMinor(rule.amountMinor), rule.currency).replace(
          ".",
          separator,
        ),
  );
  const initialCurrency =
    rule?.currency ?? fallbackAccount?.currency ?? baseCurrency;
  const [currency, setCurrency] = useState<Currency>(
    isCurrency(initialCurrency) ? initialCurrency : "EUR",
  );
  const [accountId, setAccountId] = useState(
    rule?.accountId ?? fallbackAccount?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    rule?.categoryId ?? null,
  );
  const [paidBy, setPaidBy] = useState(
    rule?.paidByUserId ??
      (members.some((m) => m.id === currentUserId)
        ? currentUserId
        : (members[0]?.id ?? "")),
  );
  const [frequency, setFrequency] = useState<Frequency>(
    rule?.frequency ?? "monthly",
  );
  const [interval, setEvery] = useState(rule?.interval ?? 1);
  const [startOn, setStartOn] = useState<string>(rule?.startOn ?? today);
  const [endOn, setEndOn] = useState<string | null>(rule?.endOn ?? null);
  const [note, setNote] = useState(rule?.note ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // The in-app keypad for the amount, as everywhere money is typed.
  const amountInput = useKeypadInput({
    value: amount,
    onChange: setAmount,
    label: t("amount"),
  });

  const failed = ({
    error,
  }: {
    error: { serverError?: string | undefined };
  }) => {
    toast.error(error.serverError ?? t("failed"));
  };
  const finish = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setConfirm(false);
      onClose();
      router.refresh();
    },
    onError: failed,
  });
  const create = useAction(createRecurring, finish(t("added")));
  const update = useAction(updateRecurring, finish(t("updated")));
  const remove = useAction(deleteRecurring, finish(t("deleted")));
  const toggle = useAction(toggleRecurring, {
    onSuccess: ({ input }) => {
      toast.success(input.active ? t("resumed") : t("pausedToast"));
      router.refresh();
    },
    onError: (args) => {
      // The switch moved optimistically; put it back.
      setActive((value) => !value);
      failed(args);
    },
  });
  const skip = useAction(skipNextRecurring, {
    onSuccess: ({ data }) => {
      toast.success(t("skipped", { date: f.dateShort(data.nextRunOn) }));
      router.refresh();
    },
    onError: failed,
  });
  const pending = create.isPending || update.isPending;

  const account = accounts.find((a) => a.id === accountId);
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const payer = members.find((m) => m.id === paidBy);
  const unit = t(`units.${frequency}`, { interval });
  const canSave =
    name.trim() !== "" &&
    amount.trim() !== "" &&
    accountId !== "" &&
    paidBy !== "" &&
    !pending;

  const save = () => {
    const values: RecurringFormValues = {
      name: name.trim(),
      type,
      accountId,
      categoryId,
      paidByUserId: paidBy,
      amount: amount.trim(),
      currency,
      frequency,
      interval,
      startOn,
      endOn,
      note: note.trim() === "" ? null : note.trim(),
    };
    if (rule === null) create.execute(values);
    else update.execute({ ...values, id: rule.id });
  };

  return (
    <>
      <SheetHeader
        title={rule === null ? t("new") : t("edit")}
        onClose={onClose}
        trailing={
          <GlassButton
            icon="check"
            tinted
            label={t("save")}
            disabled={!canSave}
            onClick={save}
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-4 pt-4 pb-10 *:shrink-0">
        <Segmented<"income" | "expense">
          label={t("kind")}
          value={type}
          onChange={(next) => {
            setType(next);
            // Categories are per kind; one of the other kind would be refused.
            if (category !== null && category.kind !== next)
              setCategoryId(null);
          }}
          options={[
            { value: "expense", label: t("expense") },
            { value: "income", label: t("income") },
          ]}
        />

        <div className="inset-group">
          <Field label={t("name")}>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              maxLength={60}
              placeholder={t("namePlaceholder")}
              aria-label={t("name")}
              className="t-body text-label-2 placeholder:text-label-3 min-w-0 flex-1 bg-transparent text-right outline-none"
            />
          </Field>
          <Field label={t("amount")}>
            {amountInput.display("t-body font-semibold")}
            <GlassMenu
              label={t("currency")}
              trigger={<MenuTrigger>{currency}</MenuTrigger>}
              entries={SUPPORTED_CURRENCIES.map((code) => ({
                key: code,
                label: code,
                checked: code === currency,
                onSelect: () => {
                  setCurrency(code);
                },
              }))}
            />
          </Field>
        </div>
        {amountInput.keypad !== null && (
          <div className="-mx-2.5 [&>div]:bg-transparent">
            {amountInput.keypad}
          </div>
        )}

        <div className="inset-group">
          <Field label={t("account")}>
            <GlassMenu
              label={t("account")}
              trigger={
                <MenuTrigger>{account?.name ?? t("choose")}</MenuTrigger>
              }
              entries={accounts.map((item) => ({
                key: item.id,
                label: item.name,
                sublabel: item.currency,
                checked: item.id === accountId,
                onSelect: () => {
                  setAccountId(item.id);
                  // The amount follows the account it is charged to.
                  if (isCurrency(item.currency)) setCurrency(item.currency);
                },
              }))}
            />
          </Field>
          <Field label={t("category")}>
            <button
              type="button"
              onClick={() => {
                setPicking(true);
              }}
              className="t-body text-label-2 flex min-w-0 items-center gap-2"
            >
              {category !== null && (
                <SymbolTile
                  icon={categorySymbol(category.icon, category.slug)}
                  color={category.color}
                  size={26}
                />
              )}
              <span className="truncate">
                {category?.name ?? t("noCategory")}
              </span>
              <Symbol
                name="chevron_right"
                size={20}
                weight={600}
                className="text-label-3"
              />
            </button>
            {category !== null && (
              <button
                type="button"
                aria-label={t("clearCategory")}
                onClick={() => {
                  setCategoryId(null);
                }}
                className="text-label-3 press grid size-7 place-items-center"
              >
                <Symbol name="close_small" size={20} weight={600} />
              </button>
            )}
          </Field>
          <Field label={t("paidBy")}>
            <GlassMenu
              label={t("paidBy")}
              trigger={
                <button
                  type="button"
                  className="t-body text-label-2 flex min-w-0 items-center gap-1.5"
                >
                  {payer !== undefined && (
                    <MemberAvatar
                      name={payer.name}
                      color={payer.color}
                      size={22}
                    />
                  )}
                  <span className="truncate">{payer?.name ?? t("choose")}</span>
                  <Symbol
                    name="unfold_more"
                    size={18}
                    weight={600}
                    className="text-label-3"
                  />
                </button>
              }
              entries={members.map((member) => ({
                key: member.id,
                label: member.name,
                checked: member.id === paidBy,
                onSelect: () => {
                  setPaidBy(member.id);
                },
              }))}
            />
          </Field>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 px-4 uppercase">
            {t("repeat")}
          </h3>
          <Segmented<Frequency>
            label={t("repeat")}
            value={frequency}
            onChange={setFrequency}
            options={[
              { value: "daily", label: t("frequency.daily") },
              { value: "weekly", label: t("frequency.weekly") },
              { value: "monthly", label: t("frequency.monthly") },
              { value: "yearly", label: t("frequency.yearly") },
            ]}
          />
          <div className="inset-group mt-1.5">
            <Field label={t("every")}>
              <span className="t-body text-label-2 truncate">{unit}</span>
              <span className="bg-ios-fill-3 ml-1 flex h-8 shrink-0 items-center rounded-full">
                <button
                  type="button"
                  aria-label={t("decrease")}
                  disabled={interval <= 1}
                  onClick={() => {
                    setEvery((value) => Math.max(1, value - 1));
                  }}
                  className="press grid h-8 w-11 place-items-center disabled:opacity-30"
                >
                  <span
                    aria-hidden
                    className="bg-label h-[2px] w-3 rounded-full"
                  />
                </button>
                <span aria-hidden className="bg-sep h-4 w-px" />
                <button
                  type="button"
                  aria-label={t("increase")}
                  disabled={interval >= 52}
                  onClick={() => {
                    setEvery((value) => Math.min(52, value + 1));
                  }}
                  className="press grid h-8 w-11 place-items-center disabled:opacity-30"
                >
                  <Symbol name="add" size={20} weight={600} />
                </button>
              </span>
            </Field>
            <Field label={t("starts")}>
              <input
                type="date"
                value={startOn}
                required
                onChange={(event) => {
                  if (event.target.value !== "") setStartOn(event.target.value);
                }}
                aria-label={t("starts")}
                className="t-body text-label-2 min-w-0 flex-1 bg-transparent text-right outline-none"
              />
            </Field>
            <Field label={t("ends")}>
              {endOn === null ? (
                <button
                  type="button"
                  onClick={() => {
                    setEndOn(startOn > today ? startOn : today);
                  }}
                  className="t-body text-label-2 flex items-center gap-0.5"
                >
                  {t("never")}
                  <Symbol
                    name="chevron_right"
                    size={20}
                    weight={600}
                    className="text-label-3"
                  />
                </button>
              ) : (
                <>
                  <input
                    type="date"
                    value={endOn}
                    min={startOn}
                    onChange={(event) => {
                      setEndOn(
                        event.target.value === "" ? null : event.target.value,
                      );
                    }}
                    aria-label={t("ends")}
                    className="t-body text-label-2 min-w-0 flex-1 bg-transparent text-right outline-none"
                  />
                  <button
                    type="button"
                    aria-label={t("noEnd")}
                    onClick={() => {
                      setEndOn(null);
                    }}
                    className="text-label-3 press grid size-7 place-items-center"
                  >
                    <Symbol name="close_small" size={20} weight={600} />
                  </button>
                </>
              )}
            </Field>
          </div>
          <p className="t-footnote text-label-2 px-4">
            {schedule({ frequency, interval, startOn })}
          </p>
        </section>

        <div className="inset-group">
          <Field label={t("note")}>
            <input
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              placeholder={t("notePlaceholder")}
              aria-label={t("note")}
              className="t-body text-label-2 placeholder:text-label-3 min-w-0 flex-1 bg-transparent text-right outline-none"
            />
          </Field>
        </div>

        {rule !== null && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="inset-group">
                <Field label={t("activeLabel")}>
                  <Switch
                    checked={active}
                    label={t("activeLabel")}
                    disabled={toggle.isPending}
                    onChange={(next) => {
                      setActive(next);
                      toggle.execute({ id: rule.id, active: next });
                    }}
                  />
                </Field>
                {active && (
                  <button
                    type="button"
                    disabled={skip.isPending}
                    onClick={() => {
                      skip.execute({ id: rule.id });
                    }}
                    className="press-row t-body text-tint flex min-h-[52px] w-full items-center px-4 text-left disabled:opacity-50"
                  >
                    {t("skipNext")}
                  </button>
                )}
              </div>
              <p className="t-footnote text-label-2 px-4 pt-0.5">
                {active
                  ? t("nextLong", { date: f.date(rule.nextRunOn) })
                  : t("pausedHint")}
              </p>
            </div>
            <ActionRow
              destructive
              onClick={() => {
                setConfirm(true);
              }}
            >
              {t("delete")}
            </ActionRow>
          </>
        )}
      </div>

      <CategoryPickerSheet
        open={picking}
        onOpenChange={setPicking}
        categories={categories}
        kind={type}
        selectedId={categoryId}
        onPick={setCategoryId}
      />

      {rule !== null && (
        <IosAlert
          open={confirm}
          onOpenChange={setConfirm}
          title={t("deleteTitle", { name: rule.name })}
          message={t("deleteMessage")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteShort")}
          pending={remove.isPending}
          onConfirm={() => {
            remove.execute({ id: rule.id });
          }}
        />
      )}
    </>
  );
}
