"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { useScrollState } from "@/components/ios/scroll-state";
import { restoreScrollOnNextNavigation } from "@/components/ios/nav-stack";
import { cn } from "@/lib/utils";

interface Tab {
  readonly href: string;
  readonly icon: SymbolName;
  readonly labelKey: "dashboard" | "transactions" | "budgets" | "more";
  /** Other routes that belong to this tab's stack. */
  readonly owns: readonly string[];
}

const TABS: readonly Tab[] = [
  { href: "/", icon: "home", labelKey: "dashboard", owns: ["/stats"] },
  {
    href: "/transactions",
    icon: "format_list_bulleted",
    labelKey: "transactions",
    owns: [],
  },
  { href: "/budgets", icon: "donut_large", labelKey: "budgets", owns: [] },
  {
    href: "/more",
    icon: "more_horiz",
    labelKey: "more",
    owns: [
      "/goals",
      "/accounts",
      "/categories",
      "/recurring",
      "/import",
      "/settings",
    ],
  },
];

/*
 * Where each tab was left: its last URL, query included (Бюджеты' month,
 * Обзор's member and period, the list's filters), or a screen pushed inside
 * it. Another tab's button returns there, as a native tab bar does — with
 * kept-alive screens (Cache Components) the screen itself is still there,
 * and this brings back the URL state it was showing. Search is a mode, not a
 * place, so it is not remembered.
 */
const lastUrl = new Map<number, string>();

function activeIndex(pathname: string): number {
  const index = TABS.findIndex((tab) =>
    [tab.href, ...tab.owns].some((root) =>
      root === "/"
        ? pathname === "/"
        : pathname === root || pathname.startsWith(`${root}/`),
    ),
  );
  return index === -1 ? 0 : index;
}

/* ------------------------------------------------------------- accessory */

/**
 * The bottom accessory (iOS 26 `tabViewBottomAccessory`): a page can hang a
 * compact summary off the tab bar, and only then does the bar minimise on
 * scroll. No screen hangs one now: the boards had Обзор's «Можно тратить»
 * there, but it only repeated the card at the top of the same screen, so the
 * owner chose a tab bar that never shrinks. Kept for a screen that has
 * something worth carrying.
 */
const AccessoryContext = createContext<{
  readonly accessory: ReactNode;
  readonly setAccessory: (node: ReactNode) => void;
}>({ accessory: null, setAccessory: () => undefined });

export function TabAccessoryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [accessory, setAccessory] = useState<ReactNode>(null);
  const value = useMemo(() => ({ accessory, setAccessory }), [accessory]);
  return <AccessoryContext value={value}>{children}</AccessoryContext>;
}

/** Rendered by a page: registers its accessory for as long as it is mounted. */
export function TabAccessory({ children }: { readonly children: ReactNode }) {
  const { setAccessory } = useContext(AccessoryContext);
  useEffect(() => {
    setAccessory(children);
    return () => {
      setAccessory(null);
    };
  }, [children, setAccessory]);
  return null;
}

/* ---------------------------------------------------------------- tab bar */

const spring = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.9,
} as const;

/**
 * The floating Liquid Glass tab bar: four tabs in one capsule and the «+»
 * action as its own glass circle (where iOS 26 puts the search tab).
 *
 * Minimised, the capsule shrinks into the active tab's circle and the
 * accessory slides out of it — one continuous motion, because the capsule
 * and the circle share a layoutId and motion interpolates their boxes. The
 * whole bar carries a view-transition-name so a push/pop slides the page
 * underneath it while the bar itself stays put, as on iOS.
 */
export function TabBar({
  onCompose,
}: {
  readonly onCompose: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const query = useSearchParams();
  useEffect(() => {
    if (query.has("search")) return;
    const qs = query.toString();
    lastUrl.set(
      activeIndex(pathname),
      qs === "" ? pathname : `${pathname}?${qs}`,
    );
  }, [pathname, query]);
  const { minimized } = useScrollState();
  const { accessory } = useContext(AccessoryContext);
  /*
   * The tapped tab lights up at once, while the next screen loads: the
   * current one stays up until then (no skeleton flash), so without this a
   * slow load would feel like the tap was missed. It lasts until the route
   * changes, then the path decides again. (Keyed only to the path it was
   * tapped on, it came back whenever that path did: tap Обзор while on
   * Бюджеты, later reach Бюджеты another way — «Все» on Обзор — and the bar
   * still lit Обзор.)
   */
  const [tapped, setTapped] = useState<{
    readonly from: string;
    readonly index: number;
  } | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setTapped(null);
  }
  const active =
    tapped !== null && tapped.from === pathname
      ? tapped.index
      : activeIndex(pathname);
  const collapsed = minimized && accessory !== null;
  /*
   * The full bar is there from the first paint; only a re-expansion (after
   * the bar has been minimised at least once) fades its tabs in. Derived
   * during render, React's pattern for state that follows a prop.
   */
  const [wasCollapsed, setWasCollapsed] = useState(false);
  if (collapsed && !wasCollapsed) setWasCollapsed(true);
  const activeTab = TABS[active] ?? TABS[0];

  /*
   * Tapping the screen you are on scrolls it back to the top. Any other tab
   * tap — another tab, or this tab's root from a screen pushed on it —
   * returns to where that screen was left, as a native tab bar does.
   */
  /*
   * Which way the screen slides for a tab tap: the tabs sit in a row, so a
   * tab to the right brings its screen in from the right and one to the left
   * from the left. This tab's own icon, tapped on a screen pushed inside it
   * (Статистика under Обзор), pops back to its root. Measured from the tab
   * the path belongs to, not the optimistic highlight.
   */
  const current = activeIndex(pathname);
  const slideTo = (
    index: number,
    href: string,
  ): { transitionTypes?: string[] } =>
    pathname === href
      ? {}
      : {
          transitionTypes: [
            index > current
              ? "ios-tab-forward"
              : index < current
                ? "ios-tab-back"
                : "ios-pop",
          ],
        };

  const onTabTap = (href: string) => {
    if (pathname === href) window.scrollTo({ top: 0, behavior: "smooth" });
    else restoreScrollOnNextNavigation();
  };

  /*
   * layoutScroll on a position: fixed element makes it motion's scroll root:
   * the capsule, the lozenge and «+» are then measured against the viewport.
   * Without it they were measured in page coordinates, and a tab switch —
   * which restores the next screen's own scroll position — read as the bar
   * having moved by the scroll difference: it was thrown that far off its
   * place and sprang back (462px from a scrolled Обзор to the top of
   * Операции). (layoutRoot does not do this: it still adds the page scroll.)
   */
  return (
    <motion.nav
      layoutScroll
      aria-label={t("main")}
      data-tabbar=""
      className="ios-fixed z-50 px-5"
      style={{
        bottom:
          "calc(max(14px, calc(var(--safe-bottom) - 6px)) - var(--vp-fix))",
        viewTransitionName: "ios-tabbar",
      }}
    >
      <LayoutGroup>
        <div className="flex items-center gap-2.5">
          {collapsed && activeTab !== undefined ? (
            <motion.div
              layoutId="tabbar-capsule"
              transition={spring}
              className="glass size-12 shrink-0 rounded-full"
            >
              <Link
                href={activeTab.href}
                scroll={false}
                {...slideTo(active, activeTab.href)}
                aria-label={t(activeTab.labelKey)}
                onClick={() => {
                  onTabTap(activeTab.href);
                }}
                className="press text-tint grid size-12 place-items-center"
              >
                <Symbol name={activeTab.icon} size={24} filled weight={600} />
              </Link>
            </motion.div>
          ) : (
            <motion.div
              layoutId="tabbar-capsule"
              transition={spring}
              className="glass flex h-[62px] min-w-0 flex-1 rounded-[31px] p-1"
            >
              {/*
               * The capsule grows out of the circle by a scale transform; the
               * tabs fade in as it does (after the page's first paint), so
               * they are never seen stretched mid-morph.
               */}
              <motion.div
                initial={wasCollapsed ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, delay: 0.06, ease: "easeOut" }}
                className="flex min-w-0 flex-1"
              >
                {TABS.map((tab, index) => {
                  const selected = index === active;
                  // This tab's own button pops to its root; others return
                  // to where they were left.
                  const target =
                    index === current
                      ? tab.href
                      : (lastUrl.get(index) ?? tab.href);
                  return (
                    <Link
                      key={tab.href}
                      href={target}
                      scroll={false}
                      {...slideTo(index, target)}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => {
                        if (index !== active)
                          setTapped({ from: pathname, index });
                        onTabTap(tab.href);
                      }}
                      className={cn(
                        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-[27px]",
                        selected ? "text-tint" : "text-label",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId="tabbar-lozenge"
                          transition={{
                            type: "spring",
                            stiffness: 600,
                            damping: 38,
                          }}
                          className="bg-ios-fill-3 absolute inset-0 rounded-[27px]"
                        />
                      )}
                      <Symbol
                        name={tab.icon}
                        size={25}
                        filled={selected}
                        weight={selected ? 600 : 500}
                        className="relative"
                      />
                      <span className="relative truncate text-[10px] leading-3 font-semibold tracking-normal">
                        {t(tab.labelKey)}
                      </span>
                    </Link>
                  );
                })}
              </motion.div>
            </motion.div>
          )}

          {/*
           * popLayout: the leaving accessory is lifted out of the row at once,
           * so the capsule gets its full width on the first frame of the
           * expansion. In the flow it kept its flex share until its exit
           * finished (~0.7s), the four tabs were squeezed to ~33px with their
           * labels overlapping, then snapped to full width.
           */}
          <AnimatePresence initial={false} mode="popLayout">
            {collapsed && (
              <motion.div
                key="accessory"
                layout
                initial={{ opacity: 0, scale: 0.6, x: -40 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.6, x: -40 }}
                transition={spring}
                className="glass flex h-12 min-w-0 flex-1 items-center rounded-full"
              >
                {accessory}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            layout
            transition={spring}
            type="button"
            aria-label={t("addTransaction")}
            onClick={onCompose}
            className={cn(
              "glass glass-tinted press grid shrink-0 place-items-center rounded-full",
              collapsed ? "size-12" : "size-[62px]",
            )}
          >
            <Symbol name="add" size={collapsed ? 26 : 30} weight={600} />
          </motion.button>
        </div>
      </LayoutGroup>
    </motion.nav>
  );
}
