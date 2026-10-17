"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Closes a sheet, alert or menu when its screen is put away.
 *
 * With Cache Components a screen you leave is hidden in React <Activity>, not
 * destroyed, so its state survives — filters, the month, a draft — which is
 * the point. A sheet or menu left open is not that kind of state: coming back
 * to a screen with a dialog already up is disorienting. Hiding runs layout
 * effect cleanups, so this closes the overlay then, and only if it was open.
 */
export function useCloseWhenHidden(open: boolean, close: () => void): void {
  const latest = useRef({ open, close });
  useLayoutEffect(() => {
    latest.current = { open, close };
  });
  useLayoutEffect(
    () => () => {
      if (latest.current.open) latest.current.close();
    },
    [],
  );
}
