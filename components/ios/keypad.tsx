"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Symbol } from "@/components/ios/symbol";
import { minus } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * The in-app amount keypad, used for every money field.
 *
 * The phone's own decimal pad is the wrong tool inside a sheet: it arrives
 * late, slides the sheet up under it, covers half the screen for eleven keys,
 * and shows whatever decimal mark the OS likes rather than the one this
 * locale writes. Owning the keys keeps the sheet still and the separator
 * right («24,80» in Russian, «24.80» in English — parseMoneyInput accepts
 * either).
 */

const BACKSPACE = "⌫";

/** The decimal mark this interface language writes between 1 and 1. */
export function useDecimalSeparator(): string {
  const locale = useLocale();
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  );
}

/**
 * One key press applied to a typed amount: at most `decimals` places, one
 * separator, no leading zeros, a sane length. A leading «-» (from the ±
 * control some fields have) is carried through untouched.
 */
export function pressKey(
  value: string,
  key: string,
  separator: string,
  decimals = 2,
): string {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  let next = body;
  if (key === BACKSPACE) next = body.slice(0, -1);
  else if (key === separator) {
    if (decimals === 0 || body.includes(separator)) return value;
    next = body === "" ? `0${separator}` : body + separator;
  } else {
    const [, fraction] = body.split(separator);
    if (fraction !== undefined && fraction.length >= decimals) return value;
    if (body.replace(separator, "").length >= 9) return value;
    next = body === "0" ? key : body + key;
  }
  return negative && next !== "" ? `-${next}` : next;
}

/** The 3×4 grid: digits on white keys, separator and backspace bare. */
export function Keypad({
  onKey,
  separator,
  label,
  className,
}: {
  readonly onKey: (key: string) => void;
  readonly separator: string;
  readonly label: string;
  readonly className?: string;
}) {
  const keys = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    separator,
    "0",
    BACKSPACE,
  ];
  return (
    <div
      role="group"
      aria-label={label}
      // Pressing a key must not steal focus from (or blur) anything.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      className={cn(
        "bg-ios-card-2 grid grid-cols-3 gap-1.5 px-1.5 pt-2",
        className,
      )}
    >
      {keys.map((key) => {
        const special = key === separator || key === BACKSPACE;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              onKey(key);
            }}
            className={cn(
              "press grid h-[46px] place-items-center rounded-xl text-[26px] font-normal tracking-normal [@media(max-height:760px)]:h-[38px] [@media(max-height:760px)]:text-[22px]",
              special
                ? "bg-transparent"
                : "bg-key shadow-[0_1px_0_rgb(0_0_0/0.3)]",
            )}
          >
            {key === BACKSPACE ? <Symbol name="backspace" size={26} /> : key}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A money value typed on the in-app keypad: returns the tappable display and
 * the keypad, so a sheet can place each where it fits.
 *
 * The keypad shows while the field is active — from the start with
 * `autoFocus`, or after a tap — and steps aside the moment a real text field
 * (a name, a note) takes focus, so the two keyboards never stack.
 */
export function useKeypadInput({
  value,
  onChange,
  label,
  autoFocus = false,
  decimals = 2,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly autoFocus?: boolean;
  readonly decimals?: number;
}): {
  readonly active: boolean;
  readonly display: (className?: string, placeholder?: string) => ReactNode;
  readonly keypad: ReactNode;
} {
  const separator = useDecimalSeparator();
  const [active, setActive] = useState(autoFocus);

  useEffect(() => {
    if (!active) return;
    const yield_ = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        setActive(false);
      }
    };
    document.addEventListener("focusin", yield_);
    return () => {
      document.removeEventListener("focusin", yield_);
    };
  }, [active]);

  const display = (className?: string, placeholder = "0") => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={active}
      onClick={() => {
        // Close the system keyboard if a text field had it.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
        setActive(true);
      }}
      className={cn(
        "money flex min-w-0 flex-1 items-center justify-end gap-0.5 text-right",
        className,
      )}
    >
      <span className={cn("truncate", value === "" && "text-label-3")}>
        {value === "" ? placeholder : minus(value)}
      </span>
      {active && (
        <span
          aria-hidden
          className="bg-tint h-[0.9em] w-[2px] shrink-0 animate-pulse rounded-full"
        />
      )}
    </button>
  );

  const keypad = active ? (
    <Keypad
      label={label}
      separator={separator}
      onKey={(key) => {
        onChange(pressKey(value, key, separator, decimals));
      }}
    />
  ) : null;

  return { active, display, keypad };
}
