"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  canPop,
  restoreScrollOnNextNavigation,
} from "@/components/ios/nav-stack";

/*
 * Full-width swipe back (iOS 26: the back gesture works from anywhere on the
 * content, not only the edge).
 *
 * The previous screen is not in the document while this one is up, so the
 * gesture brings it there: when a rightward drag starts, the current screen
 * is copied into a fixed overlay (a frozen, inert clone), and the app
 * navigates back underneath it. The finger then drags the copy off a real
 * previous screen. Released far or fast enough, the copy slides away; else it
 * springs back and the app goes forward again before the copy is removed, so
 * neither navigation is ever seen.
 */

/** The parent a back gesture leads to; set by the screen's NavBar. */
let backHref: string | null = null;

/** Registers the current screen's back destination while it is mounted. */
export function useSwipeBackTarget(href: string | undefined): void {
  useEffect(() => {
    if (href === undefined) return;
    backHref = href;
    return () => {
      if (backHref === href) backHref = null;
    };
  }, [href]);
}

/** iOS keeps its own edge swipe; ours starts inside this margin's right. */
const EDGE = 16;
/** Movement before the gesture decides it is a horizontal drag. */
const LOCK = 10;
/** Released past this share of the width, the back goes through. */
const COMMIT_SHARE = 0.33;
/** Or flicked faster than this (px/ms) to the right. */
const COMMIT_VELOCITY = 0.35;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Where a touch must not start a swipe back. */
const EXCLUDED =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [data-swipe-open], [data-no-swipe-back]';

function blocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(EXCLUDED) !== null) return true;
  // A sheet, dialog or menu is up: the gesture belongs to it.
  if (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"]',
    ) !== null
  ) {
    return true;
  }
  // A horizontal scroller that can still scroll back keeps the swipe.
  for (
    let el: Element | null = target;
    el !== null && el !== document.body;
    el = el.parentElement
  ) {
    if (el.scrollLeft > 0 && el.scrollWidth > el.clientWidth) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/** Elements whose look follows the document's scroll (scroll-driven CSS). */
const SCROLL_LINKED = ".nav-inline-title, .nav-large-title, .nav-edge";

/**
 * A still copy of `main` as it is on screen. Scroll-linked pieces have
 * their current look written inline, since the document's scroll is about to
 * become the previous screen's; field values are carried over by hand
 * (cloneNode copies attributes, not what was typed).
 */
function freeze(main: HTMLElement): HTMLElement {
  const copy = main.cloneNode(true) as HTMLElement;
  const live = main.querySelectorAll<HTMLElement>(SCROLL_LINKED);
  const still = copy.querySelectorAll<HTMLElement>(SCROLL_LINKED);
  live.forEach((element, index) => {
    const target = still[index];
    if (target === undefined) return;
    const style = getComputedStyle(element);
    target.style.animation = "none";
    target.style.transition = "none";
    target.style.opacity = style.opacity;
    target.style.transform = style.transform;
    target.style.visibility = style.visibility;
  });
  const fields = main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  const copies = copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  fields.forEach((field, index) => {
    const target = copies[index];
    if (target !== undefined) target.value = field.value;
  });
  // Screens kept alive in the background (React <Activity> hides them with
  // an important display: none) are not part of what is on screen; leave
  // them out of the copy rather than carrying them along invisibly.
  const all = [...main.querySelectorAll<HTMLElement>("*")];
  const copied = [...copy.querySelectorAll<HTMLElement>("*")];
  all.forEach((element, index) => {
    if (
      element.style.getPropertyValue("display") === "none" &&
      element.style.getPropertyPriority("display") === "important"
    ) {
      copied[index]?.remove();
    }
  });
  return copy;
}

interface Overlay {
  readonly root: HTMLDivElement;
  readonly dim: HTMLDivElement;
  readonly sheet: HTMLDivElement;
}

function mountOverlay(main: HTMLElement): Overlay {
  const root = document.createElement("div");
  root.className = "swipe-back";
  root.setAttribute("aria-hidden", "true");
  root.inert = true;
  const dim = document.createElement("div");
  dim.className = "swipe-back-dim";
  const sheet = document.createElement("div");
  sheet.className = "swipe-back-sheet";
  const page = document.createElement("div");
  page.className = "swipe-back-page";
  page.style.top = `${-window.scrollY}px`;
  page.append(freeze(main));
  sheet.append(page);
  root.append(dim, sheet);
  document.body.append(root);
  document.documentElement.toggleAttribute("data-swipe-back", true);
  return { root, dim, sheet };
}

function unmountOverlay(overlay: Overlay): void {
  overlay.root.remove();
  document.documentElement.toggleAttribute("data-swipe-back", false);
}

/** Resolves once the path is `path` and the screen has been written. */
function arrived(path: string, timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      // Let the commit (and its scroll restore) land before revealing.
      window.setTimeout(resolve, 60);
    };
    const poll = window.setInterval(() => {
      if (window.location.pathname === path) finish();
    }, 16);
    const deadline = window.setTimeout(finish, timeout);
  });
}

export function SwipeBack() {
  /*
   * The router object is replaced on every navigation (it carries
   * bfcacheId), and the gesture navigates mid-drag: depending on it would
   * re-run the effect and drop the touch in flight. Read through a ref.
   */
  const routerNow = useRouter();
  const routerRef = useRef(routerNow);
  useEffect(() => {
    routerRef.current = routerNow;
  }, [routerNow]);

  useEffect(() => {
    const router = () => routerRef.current;
    let busy = false;
    let touch: {
      readonly x: number;
      readonly y: number;
      lastX: number;
      lastT: number;
      velocity: number;
      dragging: boolean;
      overlay: Overlay | null;
      readonly from: string;
      readonly popped: boolean;
    } | null = null;

    const width = () => window.innerWidth;

    const begin = () => {
      if (touch === null || backHref === null) return false;
      const main = document.querySelector("main");
      if (main === null) return false;
      touch.overlay = mountOverlay(main);
      touch.dragging = true;
      // Navigate now, under the copy, so the real screen is what is revealed.
      if (touch.popped) {
        router().back();
      } else {
        restoreScrollOnNextNavigation();
        router().push(backHref);
      }
      return true;
    };

    const onStart = (event: TouchEvent) => {
      const point = event.touches[0];
      if (busy || event.touches.length !== 1 || point === undefined) return;
      if (backHref === null || point.clientX < EDGE || blocked(event.target))
        return;
      touch = {
        x: point.clientX,
        y: point.clientY,
        lastX: point.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        dragging: false,
        overlay: null,
        from: window.location.pathname,
        popped: canPop(),
      };
      /*
       * The rest of this touch is followed on the element it started on.
       * Touch events keep targeting that element, and the gesture navigates
       * mid-drag, which takes it out of the document — after that its moves
       * and its end no longer bubble to document, and a document listener
       * would leave the drag (and the overlay) stuck.
       */
      const origin = event.target;
      if (origin instanceof EventTarget) follow(origin);
    };

    let followed: EventTarget | null = null;
    const follow = (origin: EventTarget) => {
      unfollow();
      followed = origin;
      origin.addEventListener("touchmove", onMove as EventListener, {
        passive: false,
      });
      origin.addEventListener("touchend", onEnd);
      origin.addEventListener("touchcancel", onEnd);
    };
    const unfollow = () => {
      if (followed === null) return;
      followed.removeEventListener("touchmove", onMove as EventListener);
      followed.removeEventListener("touchend", onEnd);
      followed.removeEventListener("touchcancel", onEnd);
      followed = null;
    };

    const onMove = (event: TouchEvent) => {
      const point = event.touches[0];
      if (touch === null || point === undefined) return;
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;

      if (!touch.dragging) {
        // Mostly vertical, or leftward: a scroll or a row swipe — let it be.
        if (Math.abs(dy) > dx || dx < 0) {
          if (Math.abs(dy) > LOCK || dx < -LOCK) touch = null;
          return;
        }
        // Clearly rightward: claim it before iOS starts scrolling.
        if (dx > 2 && dx > Math.abs(dy) * 1.5 && event.cancelable)
          event.preventDefault();
        if (dx < LOCK) return;
        if (!begin()) {
          touch = null;
          return;
        }
      }

      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - touch.lastT;
      if (dt > 0) {
        touch.velocity =
          0.8 * ((point.clientX - touch.lastX) / dt) + 0.2 * touch.velocity;
      }
      touch.lastX = point.clientX;
      touch.lastT = event.timeStamp;
      const offset = Math.max(0, dx - LOCK);
      const overlay = touch.overlay;
      if (overlay !== null) {
        overlay.sheet.style.transform = `translateX(${offset}px)`;
        overlay.dim.style.opacity = String(1 - offset / width());
      }
    };

    const onEnd = () => {
      unfollow();
      const gesture = touch;
      touch = null;
      if (gesture?.dragging !== true || gesture.overlay === null) return;
      const overlay = gesture.overlay;
      busy = true;
      const w = width();
      const offset = Math.max(0, gesture.lastX - gesture.x - LOCK);
      const commit =
        offset > w * COMMIT_SHARE ||
        (gesture.velocity > COMMIT_VELOCITY && offset > 20);

      if (commit) {
        const speed = Math.max(gesture.velocity, 1.4);
        const duration = Math.min(320, Math.max(140, (w - offset) / speed));
        overlay.sheet.animate(
          [
            { transform: `translateX(${offset}px)` },
            { transform: `translateX(${w}px)` },
          ],
          { duration, easing: EASE, fill: "forwards" },
        );
        overlay.dim.animate([{ opacity: 1 - offset / w }, { opacity: 0 }], {
          duration,
          easing: EASE,
          fill: "forwards",
        });
        const target = gesture.popped ? null : backHref;
        void Promise.all([
          new Promise((resolve) => window.setTimeout(resolve, duration)),
          target === null ? Promise.resolve() : arrived(target),
        ]).then(() => {
          unmountOverlay(overlay);
          busy = false;
        });
        return;
      }

      // Not far enough: spring back, then quietly undo the navigation.
      const duration = 260;
      overlay.sheet.animate(
        [
          { transform: `translateX(${offset}px)` },
          { transform: "translateX(0)" },
        ],
        { duration, easing: EASE, fill: "forwards" },
      );
      overlay.dim.animate([{ opacity: 1 - offset / w }, { opacity: 1 }], {
        duration,
        easing: EASE,
        fill: "forwards",
      });
      window.setTimeout(() => {
        if (gesture.popped) router().forward();
        else router().back();
        void arrived(gesture.from).then(() => {
          unmountOverlay(overlay);
          busy = false;
        });
      }, duration);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      unfollow();
    };
  }, []);

  return null;
}
