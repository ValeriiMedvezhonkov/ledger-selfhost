"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Pull distance that arms the refresh, in damped pixels. */
const THRESHOLD = 70;
/** The spinner never blinks: refreshes shorter than this still show it. */
const MIN_SPIN_MS = 500;

type PtrState = "idle" | "pulling" | "refreshing";

/**
 * Pull-to-refresh for home-screen launches.
 *
 * A standalone iOS web app loses Safari's native pull-to-refresh, and this
 * household checks the app exactly that way — so the gesture is rebuilt here:
 * drag down from the top of a page, a spinner rides the pull, releasing past
 * the threshold re-fetches every server component on the page via
 * router.refresh(). That refresh is the right "reload": fresh numbers without
 * tearing down the shell or losing scroll state elsewhere.
 *
 * In a normal browser tab the component does nothing — the browser already
 * owns that gesture, and fighting it produces two spinners.
 */
export function PullToRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<PtrState>("idle");
  const [pull, setPull] = useState(0);
  const refreshStartedAt = useRef(0);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        (window.navigator as { standalone?: boolean }).standalone === true);
    if (!standalone) return;

    let startY = 0;
    let tracking = false;
    let pulled = 0;

    function reset(): void {
      tracking = false;
      pulled = 0;
      setPull(0);
      setState((current) => (current === "refreshing" ? current : "idle"));
    }

    function onStart(event: TouchEvent): void {
      if (window.scrollY > 0) return;
      // A sheet or dialog owns the touch when open — vaul's own drag must win.
      if (document.querySelector("[data-slot=drawer-content], [role=dialog]")) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      startY = touch.clientY;
      tracking = true;
      pulled = 0;
    }

    function onMove(event: TouchEvent): void {
      if (!tracking) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const dy = touch.clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pulled > 0) reset();
        else tracking = false;
        return;
      }
      // Claim the gesture from the rubber-band once it is clearly a pull.
      if (event.cancelable) event.preventDefault();
      pulled = Math.min(120, dy * 0.45);
      setPull(pulled);
      setState("pulling");
    }

    function onEnd(): void {
      if (!tracking) return;
      if (pulled >= THRESHOLD) {
        setState("refreshing");
        setPull(THRESHOLD);
        refreshStartedAt.current = Date.now();
        startTransition(() => {
          router.refresh();
        });
        tracking = false;
        pulled = 0;
        return;
      }
      reset();
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive on purpose: preventDefault() is what stops the page's own
    // overscroll bounce from fighting the indicator.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [router, startTransition]);

  // The transition ending is what says the data landed; a floor keeps the
  // spinner legible when the refresh comes back instantly.
  useEffect(() => {
    if (state !== "refreshing" || isPending) return;
    const elapsed = Date.now() - refreshStartedAt.current;
    const timer = setTimeout(
      () => {
        setState("idle");
        setPull(0);
      },
      Math.max(0, MIN_SPIN_MS - elapsed),
    );
    return () => { clearTimeout(timer); };
  }, [state, isPending]);

  const visible = state !== "idle" && pull > 4;
  const armed = pull >= THRESHOLD;

  return (
    <div
      aria-hidden={!visible}
      data-ptr-state={state}
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{
        top: "env(safe-area-inset-top)",
        transform: `translateY(${String(visible ? pull - 44 : -48)}px)`,
        transition:
          state === "pulling" ? "none" : "transform 0.25s ease, opacity 0.2s ease",
        opacity: visible ? 1 : 0,
      }}
    >
      <span
        className={cn(
          "bg-card ring-border flex size-10 items-center justify-center rounded-full shadow-lg ring-1",
          armed ? "text-primary" : "text-muted-foreground",
        )}
      >
        <RefreshCwIcon
          className={cn("size-5", state === "refreshing" && "animate-spin")}
          style={
            state === "pulling"
              ? { transform: `rotate(${String(pull * 2.4)}deg)` }
              : undefined
          }
          aria-hidden
        />
      </span>
    </div>
  );
}
