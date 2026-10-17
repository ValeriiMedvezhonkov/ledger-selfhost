"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams, type useRouter } from "next/navigation";

/**
 * In-app navigation stack, so a back button can tell a real pop (the parent
 * is the previous history entry) from a cold deep link (it is not).
 *
 * Module state rather than React state: it has to survive route changes and
 * be readable synchronously from a click handler.
 */
const stack: string[] = [];

/** Where each screen was left, so a tab switch or a pop can return there. */
const scrollByPath = new Map<string, number>();
let restorePending = false;

/**
 * The next screen should come back where it was left rather than at the top:
 * called for tab taps, and set by any history pop (the back button, the
 * edge swipe). A push leaves it unset and starts at the top.
 */
export function restoreScrollOnNextNavigation(): void {
  restorePending = true;
}

/*
 * A screen is its path — except search, which lives on /transactions behind
 * ?search=1 and is a screen of its own: opening it from a transaction is a
 * push, not a return to the list. Its other params (the query as you type,
 * filters) do not make new screens.
 */
const SEARCH_SUFFIX = "?search";

function screenKey(pathname: string, searching: boolean): string {
  return searching ? pathname + SEARCH_SUFFIX : pathname;
}

/** The previous screen's URL, or undefined after a cold deep link. */
export function previousScreen(): string | undefined {
  const key = stack.at(-2);
  return key?.endsWith(SEARCH_SUFFIX) ? `${key.slice(0, -SEARCH_SUFFIX.length)}?search=1` : key;
}

export function NavStackTracker() {
  const pathname = screenKey(usePathname(), useSearchParams().has("search"));
  const current = useRef(pathname);

  useEffect(() => {
    const record = () => {
      scrollByPath.set(current.current, window.scrollY);
    };
    window.addEventListener("scroll", record, { passive: true });
    window.addEventListener("popstate", restoreScrollOnNextNavigation);
    return () => {
      window.removeEventListener("scroll", record);
      window.removeEventListener("popstate", restoreScrollOnNextNavigation);
    };
  }, []);

  /*
   * Layout effect: runs in the commit that swaps the screen, before paint —
   * and inside a view transition's update, before the new state is captured,
   * so the slide already shows the restored position.
   */
  useLayoutEffect(() => {
    current.current = pathname;
    if (!restorePending) return;
    restorePending = false;
    window.scrollTo(0, scrollByPath.get(pathname) ?? 0);
  }, [pathname]);

  useEffect(() => {
    if (stack.at(-2) === pathname) stack.pop();
    else if (stack.at(-1) !== pathname) stack.push(pathname);
    if (stack.length > 50) stack.splice(0, stack.length - 50);
  }, [pathname]);
  return null;
}

/** Is there an in-app screen to go back to (not a cold deep link)? */
export function canPop(): boolean {
  return stack.length >= 2;
}


type Router = ReturnType<typeof useRouter>;

export interface ViewTransitionLike {
  readonly ready: Promise<unknown>;
  readonly finished: Promise<unknown>;
  readonly updateCallbackDone: Promise<unknown>;
}

/**
 * A view transition that is skipped — a second navigation lands mid-flight,
 * or a slow render outlasts the browser's timeout — rejects its promises.
 * The navigation itself still happens; only the animation is dropped, so
 * those rejections are expected and must not surface as errors.
 */
export function settle(transition: ViewTransitionLike | undefined): void {
  if (transition === undefined) return;
  const ignore = () => undefined;
  transition.ready.catch(ignore);
  transition.finished.catch(ignore);
  transition.updateCallbackDone.catch(ignore);
}

/** A pop that has not swapped the screen by now is let go unanimated. */
const POP_DEADLINE_MS = 800;

/**
 * Pop to the previous entry with the UIKit pop animation.
 *
 * `router.back()` goes through popstate and cannot carry a React transition
 * type, so the slide runs as a document view transition typed `ios-pop`
 * (app/ios.css animates the root snapshot for it). Its update callback must
 * resolve once the previous screen is actually in the DOM.
 *
 * It waits with timers and a MutationObserver — never requestAnimationFrame:
 * a browser renders nothing while a view transition is updating, so animation
 * frames do not fire and an rAF-based wait stalled until the 4-second
 * view-transition timeout, with the old screen frozen on top (the earlier
 * «back takes 3 seconds» bug).
 */
export function popBack(router: Router): void {
  const doc = document as Document & {
    startViewTransition?: (options: {
      update: () => Promise<void>;
      types?: string[];
    }) => ViewTransitionLike;
  };
  if (typeof doc.startViewTransition !== "function") {
    router.back();
    return;
  }
  const start = window.location.pathname;
  settle(
    doc.startViewTransition({
      types: ["ios-pop"],
      update: () =>
        new Promise<void>((resolve) => {
          const main = document.querySelector("main") ?? document.body;
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            observer.disconnect();
            window.clearInterval(poll);
            window.clearTimeout(deadline);
            resolve();
          };
          // The screen has changed once the path has and React has written
          // the new DOM; a short settle lets the commit finish.
          const observer = new MutationObserver(() => {
            if (window.location.pathname !== start) window.setTimeout(finish, 30);
          });
          observer.observe(main, { childList: true, subtree: true });
          const poll = window.setInterval(() => {
            if (window.location.pathname !== start) window.setTimeout(finish, 120);
          }, 16);
          const deadline = window.setTimeout(finish, POP_DEADLINE_MS);
          router.back();
        }),
    }),
  );
}
