"use client";

import { useEffect } from "react";

/** A tap moves less than this; more is a scroll or a swipe. */
const SLOP = 10;
/** Longer than this is a press-and-hold (context menus), not a tap. */
const MAX_TAP_MS = 600;
/**
 * How long to wait for iOS's own click. On device it arrives 0–51ms after
 * the finger lifts; past this it is not coming.
 */
const CLICK_WAIT_MS = 120;
/** A native click this late, after we stood in for it, is the same tap. */
const LATE_CLICK_MS = 800;

/**
 * What a tap can activate. Controls that open popups are left alone: their
 * libraries may already react to the pointer, and a second activation would
 * close what the first one opened.
 */
const TAPPABLE =
  'a[href], button:not([aria-haspopup]):not([aria-expanded]), [role="button"]:not([aria-haspopup]):not([aria-expanded]), [role="tab"], [role="option"], [role="menuitem"]';

/**
 * Makes one tap one click on iPhone.
 *
 * Safari replays a tap as mouseover → mousemove → click, and when it sees the
 * page change in response to the mouse arriving it decides the tap was a
 * "hover", keeps the hover state, and drops the click — so the first tap on a
 * control did nothing and only the second worked (recorded on device: a
 * clean touchstart/touchend on «‹ Обзор» with no click, every time, right
 * after arriving on a screen). An installed app has no hover. When a clean
 * tap on a control gets no native click in time, this delivers it; a native
 * click that turns up late after all is then swallowed, so a tap never
 * activates twice.
 */
export function TapGuard() {
  useEffect(() => {
    let start: {
      readonly x: number;
      readonly y: number;
      readonly at: number;
      readonly scrollY: number;
      readonly target: EventTarget | null;
    } | null = null;
    let timer = 0;
    let nativeClick = false;
    let standIn: { readonly element: Element; readonly at: number } | null = null;

    const onTouchStart = (event: TouchEvent) => {
      window.clearTimeout(timer);
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch === undefined) {
        start = null;
        return;
      }
      nativeClick = false;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        at: performance.now(),
        scrollY: window.scrollY,
        target: event.target,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (start === null || touch === undefined) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP) {
        start = null;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const began = start;
      start = null;
      const touch = event.changedTouches[0];
      if (began === null || touch === undefined || event.defaultPrevented) return;
      if (
        Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > SLOP ||
        performance.now() - began.at > MAX_TAP_MS ||
        Math.abs(window.scrollY - began.scrollY) > 1
      ) {
        return;
      }
      if (!(began.target instanceof Element)) return;
      const control = began.target.closest(TAPPABLE);
      if (control === null || control.matches(":disabled, [aria-disabled='true']")) return;
      // Still under the finger: a tap that slid off a control does not count.
      const under = document.elementFromPoint(touch.clientX, touch.clientY);
      if (under === null || !control.contains(under)) return;

      timer = window.setTimeout(() => {
        if (nativeClick || !control.isConnected) return;
        standIn = { element: control, at: performance.now() };
        if (control instanceof HTMLElement) control.click();
      }, CLICK_WAIT_MS);
    };

    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      if (
        standIn !== null &&
        performance.now() - standIn.at < LATE_CLICK_MS &&
        event.target instanceof Node &&
        standIn.element.contains(event.target)
      ) {
        // iOS delivered the click after all, after we already had.
        standIn = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      nativeClick = true;
      window.clearTimeout(timer);
    };

    const options = { capture: true, passive: true } as const;
    document.addEventListener("touchstart", onTouchStart, options);
    document.addEventListener("touchmove", onTouchMove, options);
    // Bubble phase on window: after the page's own handlers, so a tap they
    // cancelled (defaultPrevented) is left cancelled.
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchStart, options);
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("touchstart", onTouchStart, options);
      document.removeEventListener("touchmove", onTouchMove, options);
      window.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchStart, options);
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, []);
  return null;
}
