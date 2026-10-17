"use client";

import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ segmented */

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

/**
 * iOS 26 segmented control: a capsule track with a lozenge that slides to
 * the selection. The lozenge is one element with a layoutId scoped to this
 * control, so it travels rather than cross-fading.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const scope = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("bg-ios-fill-3 flex h-9 w-full rounded-full p-0.5", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center rounded-full px-2 text-[14px] leading-none tracking-[-0.01em]",
              selected ? "font-semibold" : "font-medium",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${scope}`}
                transition={{ type: "spring", stiffness: 560, damping: 40 }}
                className="bg-key absolute inset-0 rounded-full shadow-[0_2px_8px_rgb(0_0_0/0.12)]"
              />
            )}
            <span className="relative truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- switch */

/**
 * The iOS 26 switch (64×28, a lozenge thumb). A real checkbox carrying
 * Safari's `switch` attribute sits on top, invisible: tapping a native switch
 * is the one interaction iOS still answers with a haptic tick from the web.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-16 shrink-0 items-center rounded-full p-0.5 transition-colors duration-300",
        checked ? "bg-ios-green" : "bg-ios-fill",
        disabled && "opacity-40",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 38 }}
        className={cn(
          "h-6 w-[38px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)]",
          checked && "ml-auto",
        )}
      />
      <input
        type="checkbox"
        // Safari's native switch control; React passes unknown attributes on.
        {...{ switch: "" }}
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
      />
    </span>
  );
}

/* ---------------------------------------------------------------- chips */

/** A filter chip: glass at rest, tinted glass when it narrows the list. */
export function GlassChip({
  children,
  active = false,
  onClick,
  chevron = true,
  icon,
}: {
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly chevron?: boolean;
  readonly icon?: SymbolName;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass press flex h-[38px] shrink-0 items-center gap-1 rounded-full pr-3 pl-3.5 text-[15px] tracking-[-0.013em]",
        active ? "glass-tinted font-semibold" : "font-medium",
      )}
    >
      {icon !== undefined && <Symbol name={icon} size={16} />}
      {children}
      {chevron && (
        <Symbol
          name="keyboard_arrow_down"
          size={18}
          weight={600}
          className={active ? "text-white" : "text-label-2"}
        />
      )}
    </button>
  );
}

/** A selectable pill inside sheets («● Potraviny»), not glass. */
export function TogglePill({
  children,
  selected,
  onClick,
  dot,
}: {
  readonly children: ReactNode;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly dot?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "press flex h-[34px] shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[15px] tracking-[-0.013em] transition-colors",
        selected ? "bg-tint font-semibold text-white" : "bg-ios-fill-3 font-medium",
      )}
    >
      {dot !== undefined && (
        <span
          aria-hidden
          className="size-[9px] shrink-0 rounded-full"
          style={{ backgroundColor: selected ? "#ffffff" : dot }}
        />
      )}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- avatar */

export function MemberAvatar({
  name,
  color,
  size = 24,
  ring,
}: {
  readonly name: string;
  readonly color: string;
  readonly size?: number;
  /** Ring colour, to separate overlapping avatars. */
  readonly ring?: string;
}) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.round(size * 0.44),
        boxShadow: ring !== undefined ? `0 0 0 ${size >= 40 ? 3 : 1.5}px ${ring}` : undefined,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/* ------------------------------------------------------------ progress */

/** Activity-ring style progress; `value` 0–1 (clamped for the arc). */
export function Ring({
  value,
  size,
  stroke,
  color,
  track = "var(--ios-fill-3)",
  children,
}: {
  readonly value: number;
  readonly size: number;
  readonly stroke: number;
  readonly color: string;
  readonly track?: string;
  readonly children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** A 6px capsule progress track. */
export function Bar({
  value,
  color,
  className,
}: {
  readonly value: number;
  readonly color: string;
  readonly className?: string;
}) {
  return (
    <span className={cn("bg-ios-fill-3 block h-1.5 w-full overflow-hidden rounded-full", className)}>
      <motion.span
        className="block h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ type: "spring", stiffness: 140, damping: 24 }}
      />
    </span>
  );
}
