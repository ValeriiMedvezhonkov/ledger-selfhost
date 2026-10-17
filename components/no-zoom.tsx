"use client";

import { useEffect } from "react";

/**
 * Keeps the installed app at 1:1, like a native one.
 *
 * The viewport meta says user-scalable=no / maximum-scale=1, which also stops
 * iOS zooming into a focused field — but Safari has ignored user-scalable for
 * pinch since iOS 10, so the pinch is refused here by cancelling WebKit's
 * gesture events and any two-finger touchmove. Double-tap zoom is handled in
 * CSS (`touch-action: manipulation` on <html>).
 */
export function NoZoom() {
  useEffect(() => {
    const cancel = (event: Event) => {
      event.preventDefault();
    };
    const pinch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
      document.addEventListener(name, cancel, { passive: false });
    }
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
        document.removeEventListener(name, cancel);
      }
      document.removeEventListener("touchmove", pinch);
    };
  }, []);
  return null;
}
