"use client";

import type { FocusEvent, ReactNode } from "react";

/** The keyboard counts as up once the visible area has lost this much. */
const KEYBOARD_MIN = 80;

/**
 * Makes sure a focused field ends up above the on-screen keyboard.
 *
 * iOS normally scrolls a focused field into view by itself, but in an
 * installed app on iOS 26 the first keyboard of a session can arrive without
 * that scroll and leave the field covered. This asks once — after the
 * keyboard has finished opening, signalled by the visual viewport shrinking —
 * for the field to be scrolled into view. It changes no layout and does
 * nothing while you scroll, so native scrolling stays native.
 */
function reveal(field: HTMLElement): void {
  const viewport = window.visualViewport;
  const go = () => {
    field.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  if (viewport === null) return;

  // Already up (moving from one field to the next): just make sure.
  if (window.innerHeight - viewport.height > KEYBOARD_MIN) {
    requestAnimationFrame(go);
    return;
  }

  const startHeight = viewport.height;
  let timer = 0;
  const done = () => {
    viewport.removeEventListener("resize", onResize);
    window.clearTimeout(timer);
  };
  const onResize = () => {
    if (viewport.height < startHeight - KEYBOARD_MIN) {
      done();
      requestAnimationFrame(go);
    }
  };
  viewport.addEventListener("resize", onResize);
  // A hardware keyboard never shrinks anything; stop listening after a while.
  timer = window.setTimeout(done, 1200);
}

export function RevealOnFocus({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={className}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          reveal(target);
        }
      }}
    >
      {children}
    </div>
  );
}
