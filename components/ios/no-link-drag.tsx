"use client";

import { useEffect } from "react";

/**
 * Links and images in the installed app cannot be picked up and dragged.
 *
 * iOS Safari lifts a long-pressed link into a drag-and-drop card (title,
 * icon text, host) that can be dropped into other apps — a web page's
 * behaviour, not an app's. `-webkit-user-drag: none` in app/ios.css stops it
 * where honoured; cancelling `dragstart` covers the rest. Only links and
 * images: nothing in the app relies on dragging them, and other drags (text
 * selection in fields) are left alone.
 */
export function NoLinkDrag() {
  useEffect(() => {
    const cancel = (event: DragEvent) => {
      if (event.target instanceof Element && event.target.closest("a, img") !== null) {
        event.preventDefault();
      }
    };
    document.addEventListener("dragstart", cancel, { capture: true });
    return () => {
      document.removeEventListener("dragstart", cancel, { capture: true });
    };
  }, []);
  return null;
}
