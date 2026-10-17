"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  readonly key: string;
  readonly label: string;
  readonly icon: SymbolName;
  readonly color: string;
  readonly onSelect: () => void;
}

/** Each action is a 48pt capsule; the tray adds its own padding. */
const ACTION_W = 62;
const AXIS_LOCK = 8;

/**
 * Trailing swipe actions as iOS 26 draws them: the row slides left and a
 * tray of round capsules (category, delete) comes out from under it (board
 * L03). A long swipe past most of the row's width commits the last
 * (destructive) action, like UIKit's full swipe.
 *
 * Pointer-based with an axis lock, so a vertical scroll that starts on a row
 * never drags it sideways. Mouse pointers are ignored — the context menu
 * (right click) covers desktop.
 */
export function SwipeActions({
  children,
  actions,
  className,
}: {
  readonly children: ReactNode;
  readonly actions: readonly SwipeAction[];
  readonly className?: string;
}) {
  const tray = actions.length * ACTION_W + 10;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; offset: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const width = useRef(360);
  const suppress = useRef(false);

  const settle = (to: number) => {
    setDragging(false);
    setOffset(to);
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    start.current = { x: event.clientX, y: event.clientY, offset };
    axis.current = null;
    width.current = event.currentTarget.offsetWidth;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (axis.current === null) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axis.current === "h") event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (axis.current !== "h") return;
    setDragging(true);
    suppress.current = true;
    const next = Math.min(0, start.current.offset + dx);
    // Past the tray the row resists, like rubber, until the full-swipe zone.
    const beyond = -next - tray;
    setOffset(beyond > 0 ? -(tray + beyond * 0.7) : next);
  };
  const up = () => {
    if (start.current === null) return;
    start.current = null;
    if (axis.current !== "h") {
      axis.current = null;
      return;
    }
    axis.current = null;
    const last = actions.at(-1);
    if (-offset > width.current * 0.62 && last !== undefined) {
      settle(-width.current);
      window.setTimeout(() => {
        last.onSelect();
        setOffset(0);
      }, 220);
      return;
    }
    settle(-offset > tray / 2 ? -tray : 0);
  };

  const open = offset < 0;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        aria-hidden={!open}
        className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2.5 pl-1.5"
        style={{ width: Math.max(tray, -offset) }}
      >
        {actions.map((action, index) => (
          <button
            key={action.key}
            type="button"
            tabIndex={open ? 0 : -1}
            aria-label={action.label}
            onClick={() => {
              setOffset(0);
              action.onSelect();
            }}
            className="press grid h-12 min-w-12 flex-1 place-items-center rounded-full text-white transition-[flex-grow] duration-200"
            style={{
              backgroundColor: action.color,
              flexGrow: index === actions.length - 1 && -offset > tray + 40 ? 6 : 1,
            }}
          >
            <Symbol name={action.icon} size={22} weight={600} />
          </button>
        ))}
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(event) => {
          if (suppress.current || offset !== 0) {
            suppress.current = false;
            event.preventDefault();
            event.stopPropagation();
            if (offset !== 0 && !dragging) settle(0);
          }
        }}
        // An open (or opening) row takes a rightward swipe to close itself.
        data-swipe-open={open || dragging ? "" : undefined}
        className="bg-ios-card relative touch-pan-y"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 0.42s var(--ease-ios)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
