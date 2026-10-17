"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface ScrollState {
  /** Past the large title: the inline title and split toolbar take over. */
  readonly scrolled: boolean;
  /** Scrolling down past the first screenful: the tab bar minimises. */
  readonly minimized: boolean;
}

const Context = createContext<ScrollState>({ scrolled: false, minimized: false });

/**
 * Where UIKit swaps titles: the large title (41pt, right under the toolbar)
 * has started to leave its row beside the glass buttons. Kept just ahead of
 * the inline title's CSS range (16–34px in app/ios.css), and just after the
 * large title has faded (0–12px), so nothing shares the leading spot so a toolbar that
 * rearranges (Обзор) has made room before the inline title appears.
 */
const SCROLLED_AT = 14;
/** Below this the tab bar is always expanded, as at the top of a list. */
const MINIMIZE_AFTER = 120;
/** Direction changes smaller than this are finger jitter, not intent. */
const HYSTERESIS = 8;

/**
 * Document scroll, read once per frame and published as two booleans.
 *
 * The continuous effects (title fade, edge blur) are CSS scroll-driven
 * animations and never touch React. What needs a *decision* — swap the
 * toolbar layout, minimise the tab bar — reads from here. Direction is taken
 * against the last position at which it changed, with a dead zone, so a
 * resting finger does not make the bar flicker; and positions are clamped to
 * the real scroll range, so iOS rubber-banding (negative scrollY, or past the
 * end) is not misread as scrolling up or down.
 *
 * `data-scrolled` on <html> drives the CSS fallback where scroll timelines
 * are not supported.
 */
export function ScrollStateProvider({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const anchor = useRef(0);
  const frame = useRef(0);

  /*
   * A layout effect, so a new screen's scrolled state is set in the same
   * commit that shows it — before paint, and before a view transition
   * captures the incoming screen. As a passive effect it ran a frame later:
   * the new screen first inherited the previous one's `data-scrolled` and
   * showed its toolbar blur for a moment, then faded it out. NavStackTracker
   * (a child, so its layout effect runs first) has already restored the
   * scroll position by the time this reads it.
   */
  useLayoutEffect(() => {
    /*
     * A screen arrives with the tab bar out, wherever it is scrolled — a tab
     * switch restores the old position (components/ios/nav-stack), and that
     * jump is not the user scrolling down. Direction is measured from here.
     */
    let arriving = true;
    const read = () => {
      frame.current = 0;
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const y = Math.min(Math.max(window.scrollY, 0), max);

      const isScrolled = y > SCROLLED_AT;
      setScrolled(isScrolled);
      const root = document.documentElement;
      if (arriving) {
        /*
         * A screen arrives already in its scrolled state: the edge blur is
         * on or off, never fading from the previous screen's state. The
         * scroll restore just before this has already computed the blur
         * with the old flag, so without this its 0.22s fade-out ran on the
         * new screen. Transitions off, flag set, style applied (the
         * layout read flushes it), transitions back.
         */
        root.toggleAttribute("data-arriving", true);
        root.toggleAttribute("data-scrolled", isScrolled);
        root.getBoundingClientRect();
        root.toggleAttribute("data-arriving", false);
      } else {
        root.toggleAttribute("data-scrolled", isScrolled);
      }

      if (arriving) {
        arriving = false;
        setMinimized(false);
        anchor.current = y;
        return;
      }
      if (y < MINIMIZE_AFTER) {
        setMinimized(false);
        anchor.current = y;
        return;
      }
      const delta = y - anchor.current;
      if (delta > HYSTERESIS) {
        setMinimized(true);
        anchor.current = y;
      } else if (delta < -HYSTERESIS) {
        setMinimized(false);
        anchor.current = y;
      }
    };
    const onScroll = () => {
      if (frame.current === 0) frame.current = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    };
  }, [pathname]);

  const value = useMemo(() => ({ scrolled, minimized }), [scrolled, minimized]);
  return <Context value={value}>{children}</Context>;
}

export function useScrollState(): ScrollState {
  return useContext(Context);
}
