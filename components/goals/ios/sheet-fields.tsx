"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { toISODate, type ISODate } from "@/lib/date";
import {
  SUPPORTED_CURRENCIES,
  minorToInputString,
  type Minor,
} from "@/lib/money";
import { currencySymbol } from "@/lib/currencies";
import { useFormats } from "@/hooks/use-formats";
import { GlassMenu, type MenuEntry } from "@/components/ios/menu";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import { SheetCalendar } from "@/components/ios/sheet-calendar";
import { useKeypadInput } from "@/components/ios/keypad";
import { cn } from "@/lib/utils";

/*
 * The form vocabulary the Цели and Счета edit sheets share. Neither sheet is
 * drawn on the boards, so they are built from what the drawn sheets already
 * use: Новая запись's grouped rows (label left, value right, hairline after
 * the label) and its big tabular amount field. Shared rather than copied so
 * the two settings screens cannot drift apart in how a field looks.
 */

/** A grouped row: label at the leading edge, the control right-aligned. */
export function FieldRow({
  label,
  children,
  htmlFor,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly htmlFor?: string;
}) {
  return (
    <div className="flex min-h-[52px] items-center pl-4">
      <div className="row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-3 pr-4">
        <label htmlFor={htmlFor} className="t-body shrink-0">
          {label}
        </label>
        <div className="flex min-w-0 flex-1 justify-end">{children}</div>
      </div>
    </div>
  );
}

/** A plain text input that sits on the trailing side of a FieldRow. */
export function RowInput({
  id,
  value,
  onChange,
  placeholder,
  inputMode,
  autoFocus = false,
  className,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly inputMode?: "text" | "decimal";
  readonly autoFocus?: boolean;
  readonly className?: string;
}) {
  return (
    <input
      id={id}
      value={value}
      autoFocus={autoFocus}
      autoComplete="off"
      inputMode={inputMode ?? "text"}
      {...(placeholder !== undefined ? { placeholder } : {})}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className={cn(
        "t-body text-label-2 placeholder:text-label-3 min-w-0 flex-1 bg-transparent text-right outline-none",
        className,
      )}
    />
  );
}

/** A FieldRow whose value is picked from a glass pull-down menu. */
export function MenuRow({
  label,
  value,
  entries,
}: {
  readonly label: string;
  readonly value: string;
  readonly entries: readonly MenuEntry[];
}) {
  return (
    <FieldRow label={label}>
      <GlassMenu
        label={label}
        trigger={
          <button
            type="button"
            className="t-body text-label-2 flex min-w-0 items-center gap-0.5"
          >
            <span className="truncate">{value}</span>
            <Symbol
              name="unfold_more"
              size={18}
              weight={600}
              className="text-label-3"
            />
          </button>
        }
        entries={entries}
      />
    </FieldRow>
  );
}

/** «Валюта»: every supported currency, the selected one ticked. */
export function CurrencyRow({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (currency: string) => void;
}) {
  const symbol = currencySymbol(value);
  return (
    <MenuRow
      label={label}
      value={symbol === value ? value : `${value} · ${symbol}`}
      entries={SUPPORTED_CURRENCIES.map((code) => ({
        key: code,
        label: code,
        sublabel: currencySymbol(code),
        checked: code === value,
        onSelect: () => {
          onChange(code);
        },
      }))}
    />
  );
}

/**
 * The big amount field (Бюджеты' «Лимит» card): label left, a 28pt bold
 * tabular figure right, the currency symbol after it so the unit is never
 * in doubt.
 */
const PLUS_MINUS = "±";

export function AmountField({
  label,
  value,
  onChange,
  currency,
  autoFocus = false,
  signLabel,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly currency: string;
  readonly autoFocus?: boolean;
  /**
   * Shows a «±» key that flips the sign. iOS's decimal keypad has no minus,
   * so an amount that may be negative (a credit card's opening balance)
   * needs its own way to get one. The string is the key's accessible name.
   */
  readonly signLabel?: string;
}) {
  const symbol = currencySymbol(currency);
  // The in-app keypad, as on Новая запись — never the system keyboard.
  const input = useKeypadInput({ value, onChange, label, autoFocus });
  return (
    <>
      <div className="bg-ios-card flex h-[60px] items-center gap-2 rounded-[18px] px-4">
        <span className="t-body text-label-2 shrink-0">{label}</span>
        {signLabel !== undefined && (
          <button
            type="button"
            aria-label={signLabel}
            onClick={() => {
              onChange(value.startsWith("-") ? value.slice(1) : `-${value}`);
            }}
            className="bg-ios-fill-3 press text-label grid size-8 shrink-0 place-items-center rounded-full text-[19px] leading-none font-semibold"
          >
            {PLUS_MINUS}
          </button>
        )}
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

/** A medium glass sheet holding a month calendar; picking a day closes it. */
export function DateSheet({
  open,
  onOpenChange,
  title,
  value,
  onPick,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly value: ISODate | null;
  readonly onPick: (value: ISODate) => void;
}) {
  const f = useFormats();
  // Noon, so no timezone can push the selected day across midnight.
  const selected = value === null ? undefined : new Date(`${value}T12:00:00`);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      detent="medium"
      title={title}
    >
      <SheetHeader
        title={title}
        onClose={() => {
          onOpenChange(false);
        }}
      />
      <div className="px-4 pt-2 pb-8">
        <SheetCalendar
          mode="single"
          selected={selected}
          {...(selected !== undefined ? { defaultMonth: selected } : {})}
          onSelect={(picked) => {
            if (picked !== undefined) onPick(toISODate(picked));
            onOpenChange(false);
          }}
          locale={f.calendar}
        />
      </div>
    </Sheet>
  );
}

/**
 * Minor units as the text a person would type in the interface language:
 * «1250» rather than «1250.00», «12,50» in Russian. parseMoneyInput reads
 * either separator back, so this is purely about looking typed, not exported.
 */
export function useMoneyInput(): (minor: Minor, currency: string) => string {
  const locale = useLocale();
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return (minor, currency) => {
    const text = minorToInputString(minor, currency);
    const [whole = "", fraction = ""] = text.split(".");
    return /^0*$/.test(fraction) ? whole : `${whole}${separator}${fraction}`;
  };
}
