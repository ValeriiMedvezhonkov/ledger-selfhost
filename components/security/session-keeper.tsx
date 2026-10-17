"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Quiet enough to be invisible, frequent enough to beat a seven-day session. */
const INTERVAL_MS = 10 * 60 * 1000;

/**
 * How long the tab must have been hidden before returning to it triggers a
 * check. Switching tabs for a moment should not cause a request; coming back to
 * a laptop the next morning should.
 */
const STALE_AFTER_MS = 60 * 1000;

/**
 * Keeps the session alive while a page sits open.
 *
 * Renders nothing. It exists because renewal by redirect only happens when
 * something asks for a page — a tab left open overnight would lapse in place
 * and the next click would be a Server Action that fails, which cannot redirect
 * anywhere useful. Checking on a timer, and whenever the tab is looked at
 * again, means the session is already current by the time anything is clicked.
 */
export function SessionKeeper() {
  const router = useRouter();
  const hiddenSince = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      // Waking from sleep can fire the timer and the visibility handler at
      // once; one request is enough.
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        const response = await fetch("/api/session/keepalive", {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;

        const body = (await response.json()) as { status?: string };

        if (body.status === "signed-out") {
          router.replace("/login");
          return;
        }

        /*
         * A renewal means this page was rendered under a session that no longer
         * exists. Refreshing pulls it back in sync — without it the page keeps
         * working, but anything cached against the old session goes stale.
         */
        if (body.status === "renewed") router.refresh();
      } catch {
        /*
         * Offline, asleep, or the server briefly unreachable. Deliberately
         * silent: a failed check is not evidence of being signed out, and
         * bouncing someone to the login page over a dropped request would be
         * far worse than waiting for the next tick.
         */
      } finally {
        inFlight.current = false;
      }
    }

    const timer = setInterval(() => void check(), INTERVAL_MS);

    function onVisibility(): void {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }

      const since = hiddenSince.current;
      hiddenSince.current = null;
      if (since !== null && Date.now() - since > STALE_AFTER_MS) void check();
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
