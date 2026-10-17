"use client";

import Link from "next/link";
import type * as React from "react";
import type { ComponentProps, ReactNode } from "react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

type TransitionTypes = ComponentProps<typeof Link>["transitionTypes"];

interface PressableBase {
  readonly className?: string;
  readonly href?: string;
  /** View-transition types for links: ["ios-push"] / ["ios-pop"]. */
  readonly transitionTypes?: TransitionTypes;
  readonly onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
}

function Pressable({
  className,
  href,
  transitionTypes,
  onClick,
  disabled,
  type = "button",
  children,
  ...aria
}: PressableBase & {
  readonly children: ReactNode;
  readonly "aria-label"?: string;
  readonly "aria-pressed"?: boolean;
  readonly "aria-expanded"?: boolean;
}) {
  if (href !== undefined) {
    return (
      <Link
        href={href}
        className={className}
        {...(onClick !== undefined ? { onClick } : {})}
        {...(transitionTypes !== undefined ? { transitionTypes } : {})}
        {...aria}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      {...aria}
    >
      {children}
    </button>
  );
}

export interface GlassButtonProps extends PressableBase {
  readonly icon: SymbolName;
  readonly label: string;
  readonly tinted?: boolean;
  /** 48 is the toolbar size; the tab bar's «+» is 62. */
  readonly size?: 44 | 48 | 62;
  readonly iconSize?: number;
}

/** The round Liquid Glass toolbar button (48pt, 22pt glyph). */
export function GlassButton({
  icon,
  label,
  tinted = false,
  size = 48,
  iconSize,
  className,
  ...rest
}: GlassButtonProps) {
  return (
    <Pressable
      {...rest}
      aria-label={label}
      className={cn(
        "glass press grid shrink-0 place-items-center rounded-full disabled:opacity-40",
        size === 62 ? "size-[62px]" : size === 44 ? "size-11" : "size-12",
        tinted ? "glass-tinted" : "text-label",
        className,
      )}
    >
      <Symbol
        name={icon}
        size={iconSize ?? (size === 62 ? 30 : size === 44 ? 20 : 22)}
        weight={tinted ? 600 : 500}
      />
    </Pressable>
  );
}

export interface GlassPillProps extends PressableBase {
  readonly children: ReactNode;
  readonly leadingIcon?: SymbolName;
  readonly tinted?: boolean;
  readonly label?: string;
}

/** A capsule glass button with text: «Изменить», «Сбросить», «‹ Ещё». */
export function GlassPill({
  children,
  leadingIcon,
  tinted = false,
  label,
  className,
  ...rest
}: GlassPillProps) {
  return (
    <Pressable
      {...rest}
      {...(label !== undefined ? { "aria-label": label } : {})}
      className={cn(
        "glass press t-headline flex h-12 shrink-0 items-center gap-1 rounded-full px-[18px] disabled:opacity-40",
        tinted ? "glass-tinted" : "text-label",
        leadingIcon !== undefined && "pl-3",
        className,
      )}
    >
      {leadingIcon !== undefined && (
        <Symbol name={leadingIcon} size={24} weight={600} />
      )}
      {children}
    </Pressable>
  );
}

export interface GlassGroupItem {
  readonly icon: SymbolName;
  readonly label: string;
  readonly href?: string;
  readonly onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

/** Two or three icon buttons sharing one glass capsule (iOS 26 toolbar group). */
export function GlassGroup({
  items,
  className,
}: {
  readonly items: readonly GlassGroupItem[];
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "glass flex h-12 shrink-0 items-center rounded-full px-1.5 text-label",
        className,
      )}
    >
      {items.map((item) => (
        <Pressable
          key={item.label}
          aria-label={item.label}
          {...(item.href !== undefined ? { href: item.href } : {})}
          {...(item.onClick !== undefined ? { onClick: item.onClick } : {})}
          className="press grid h-12 w-[42px] place-items-center rounded-full"
        >
          <Symbol name={item.icon} size={22} />
        </Pressable>
      ))}
    </div>
  );
}

/** The full-width tinted call to action: «Показать 23 операции», «Войти». */
export function ProminentButton({
  children,
  className,
  pending = false,
  ...rest
}: PressableBase & { readonly children: ReactNode; readonly pending?: boolean }) {
  return (
    <Pressable
      {...rest}
      className={cn(
        "glass glass-tinted press t-headline flex h-[52px] w-full items-center justify-center rounded-full px-6 disabled:opacity-50",
        pending && "opacity-70",
        className,
      )}
    >
      {children}
    </Pressable>
  );
}
