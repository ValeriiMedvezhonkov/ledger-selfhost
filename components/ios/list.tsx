"use client";

import Link from "next/link";
import type * as React from "react";
import type { ReactNode } from "react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------- containers */

/**
 * An inset grouped section (radius 26, iOS 26). Optional small-caps header
 * above and a footnote below, both outside the card, as UITableView draws
 * them.
 */
export function InsetGroup({
  header,
  footer,
  children,
  className,
}: {
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      {header !== undefined && (
        <h2 className="t-footnote text-label-2 px-4 font-semibold uppercase">
          {header}
        </h2>
      )}
      <div className={cn("inset-group", className)}>{children}</div>
      {footer !== undefined && (
        <p className="t-footnote text-label-2 px-4 pt-0.5">{footer}</p>
      )}
    </section>
  );
}

/** «Бюджеты · Все»: a 20pt bold heading with an optional trailing link. */
export function SectionHeader({
  title,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly action?: { readonly label: string; readonly href?: string; readonly onClick?: () => void; readonly transitionTypes?: string[] } | undefined;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-2 px-4", className)}>
      <h2 className="t-title3 min-w-0 flex-1 truncate">{title}</h2>
      {action !== undefined &&
        (action.href !== undefined ? (
          <Link
            href={action.href}
            {...(action.transitionTypes !== undefined
              ? { transitionTypes: action.transitionTypes }
              : {})}
            className="t-body text-tint"
          >
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="t-body text-tint">
            {action.label}
          </button>
        ))}
    </div>
  );
}

/* ---------------------------------------------------------------- tiles */

/** The rounded-square glyph tile UIKit settings rows use (30pt, r8). */
export function SymbolTile({
  icon,
  color,
  size = 30,
  className,
}: {
  readonly icon: SymbolName;
  readonly color: string;
  readonly size?: 26 | 30 | 38 | 40 | 52 | 76;
  readonly className?: string;
}) {
  const radius = size >= 76 ? 22 : size >= 40 ? 11 : size >= 38 ? 10 : 8;
  const glyph = size >= 76 ? 40 : size >= 52 ? 28 : size >= 38 ? 22 : 18;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center text-white", className)}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: color }}
    >
      <Symbol name={icon} size={glyph} weight={600} />
    </span>
  );
}

/* ----------------------------------------------------------------- rows */

export type RowAccessory = "chevron" | "check" | "none";

export interface ListRowProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly value?: ReactNode;
  readonly tile?: { readonly icon: SymbolName; readonly color: string } | ReactNode;
  readonly accessory?: RowAccessory;
  /** Anything else at the trailing edge: a switch, a badge. */
  readonly trailing?: ReactNode;
  readonly href?: string;
  readonly transitionTypes?: string[];
  readonly onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  readonly destructive?: boolean;
  readonly tinted?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

function isTileSpec(
  tile: ListRowProps["tile"],
): tile is { readonly icon: SymbolName; readonly color: string } {
  return typeof tile === "object" && tile !== null && "icon" in tile && "color" in tile;
}

/**
 * A grouped-table row: tile · title (+subtitle) · value · accessory. 52pt
 * single-line, taller with a subtitle. The hairline separator belongs to the
 * text column, so it starts after the tile like UITableView's.
 */
export function ListRow({
  title,
  subtitle,
  value,
  tile,
  accessory = "chevron",
  trailing,
  href,
  transitionTypes = ["ios-push"],
  onClick,
  destructive = false,
  tinted = false,
  disabled = false,
  className,
}: ListRowProps) {
  const content = (
    <>
      {tile !== undefined &&
        (isTileSpec(tile) ? <SymbolTile icon={tile.icon} color={tile.color} /> : tile)}
      <span className="row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-1.5 self-stretch py-2 pr-4">
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "t-body truncate",
              destructive && "text-ios-red",
              tinted && "text-tint",
            )}
          >
            {title}
          </span>
          {subtitle !== undefined && (
            <span className="t-footnote text-label-2 truncate">{subtitle}</span>
          )}
        </span>
        {value !== undefined && (
          <span className="t-body text-label-2 max-w-[55%] shrink-0 truncate text-right">
            {value}
          </span>
        )}
        {accessory === "chevron" ? (
          <Symbol name="chevron_right" size={20} weight={600} className="text-label-3 -mr-1" />
        ) : accessory === "check" ? (
          <Symbol name="check" size={20} weight={600} className="text-tint" />
        ) : null}
        {trailing}
      </span>
    </>
  );

  const classes = cn(
    "press-row flex w-full items-center gap-3.5 pl-4 text-left transition-colors",
    disabled && "pointer-events-none opacity-40",
    className,
  );

  if (href !== undefined) {
    return (
      <Link
        href={href}
        transitionTypes={transitionTypes}
        {...(onClick !== undefined ? { onClick } : {})}
        className={classes}
      >
        {content}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} className={classes} disabled={disabled}>
        {content}
      </button>
    );
  }
  return <div className={cn(classes, "active:bg-transparent")}>{content}</div>;
}

/** A centred full-width action row: «Удалить операцию», «Выйти». */
export function ActionRow({
  children,
  onClick,
  destructive = false,
  disabled = false,
  type = "button",
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inset-group press-row t-body flex h-[52px] w-full items-center justify-center disabled:opacity-50",
        destructive ? "text-ios-red" : "text-tint",
      )}
    >
      {children}
    </button>
  );
}
