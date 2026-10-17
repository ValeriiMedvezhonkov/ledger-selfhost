"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- pace lines */

export interface PaceLinesProps {
  readonly width: number;
  readonly height: number;
  /** Running total for the days so far. */
  readonly current: readonly number[];
  /** The comparison's running total over the whole period. */
  readonly compare: readonly number[];
  readonly totalDays: number;
  readonly projection?: number | null;
  readonly budget?: number | null;
  /** Drawn under the budget rule, in its red. */
  readonly budgetLabel?: string | undefined;
  /** Where the lines start: 0 for a running total. */
  readonly origin?: number;
  readonly strokeWidth?: number;
}

/**
 * The month's pace (board L15 «Темп»): this period's running total in the
 * tint, the comparison's in fill behind it, the rest of the period dotted on
 * to the projection, and the budget as a red rule. Drawn at the measured size
 * rather than a stretched viewBox, so dots stay round and lines even.
 */
export function PaceLines({
  width,
  height,
  current,
  compare,
  totalDays,
  projection = null,
  budget = null,
  budgetLabel,
  origin = 0,
  strokeWidth = 3.5,
}: PaceLinesProps) {
  const top = 8;
  const bottom = 6;
  const max = Math.max(1, origin, budget ?? 0, projection ?? 0, ...current, ...compare) * 1.04;
  const x = (day: number) => (day / Math.max(1, totalDays)) * (width - 8) + 4;
  const y = (value: number) => height - bottom - (value / max) * (height - top - bottom);
  const path = (values: readonly number[]) =>
    [`M${x(0)},${y(origin)}`, ...values.map((value, index) => `L${x(index + 1)},${y(value)}`)].join(" ");

  const last = current.at(-1) ?? 0;
  const lastX = x(current.length);
  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      {budget !== null && (
        <line
          x1={0}
          x2={width}
          y1={y(budget)}
          y2={y(budget)}
          stroke="var(--ios-red)"
          strokeOpacity={0.5}
          strokeWidth={1.5}
        />
      )}
      {budget !== null && budgetLabel !== undefined && (
        <text x={2} y={y(budget) + 15} fill="var(--ios-red)" fontSize={11} fontWeight={600}>
          {budgetLabel}
        </text>
      )}
      {compare.length > 0 && (
        <path
          d={path(compare)}
          fill="none"
          stroke="var(--ios-fill)"
          strokeWidth={strokeWidth - 0.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {projection !== null && current.length < totalDays && (
        <line
          x1={lastX}
          y1={y(last)}
          x2={x(totalDays)}
          y2={y(projection)}
          stroke="var(--ios-tint)"
          strokeWidth={strokeWidth + 0.5}
          strokeLinecap="round"
          strokeDasharray={`0 ${strokeWidth * 3.6}`}
        />
      )}
      {current.length > 0 && (
        <>
          <path
            d={path(current)}
            fill="none"
            stroke="var(--ios-tint)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {current.length < totalDays && (
            <circle
              cx={lastX}
              cy={y(last)}
              r={strokeWidth * 1.9}
              fill="var(--ios-tint)"
              stroke="var(--ios-card)"
              strokeWidth={2}
            />
          )}
        </>
      )}
    </svg>
  );
}

/** The card's own width, for charts that draw at their real size. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

/* ------------------------------------------------------------ bar columns */

export interface BarSegment {
  readonly value: number;
  readonly color: string;
  readonly opacity?: number;
}

/**
 * Columns of stacked segments (bottom first) with a label under each — the
 * six-month charts. Segments are separate rounded blocks with a 3pt gap, as
 * the boards draw them.
 */
export function StackedColumns({
  columns,
  height = 140,
  gap = 14,
}: {
  readonly columns: readonly {
    readonly key: string;
    readonly label: ReactNode;
    readonly strong?: boolean;
    readonly segments: readonly BarSegment[];
  }[];
  readonly height?: number;
  readonly gap?: number;
}) {
  const max = Math.max(
    1,
    ...columns.map((column) => column.segments.reduce((total, s) => total + s.value, 0)),
  );
  return (
    <div className="flex" style={{ gap }}>
      {columns.map((column) => {
        const shown = column.segments.filter((segment) => segment.value > 0);
        return (
          <div key={column.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-col-reverse gap-[3px]" style={{ height }}>
              {shown.map((segment, index) => (
                <span
                  key={index}
                  className="block w-full shrink-0 rounded-[7px]"
                  style={{
                    height: Math.max(3, (segment.value / max) * (height - 3 * (shown.length - 1))),
                    backgroundColor: segment.color,
                    opacity: segment.opacity,
                  }}
                />
              ))}
            </div>
            <span className={cn("t-caption", column.strong === true ? "font-bold" : "text-label-2")}>
              {column.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A small legend dot and label. */
export function LegendDot({
  color,
  children,
}: {
  readonly color: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="t-footnote text-label-2 flex items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
