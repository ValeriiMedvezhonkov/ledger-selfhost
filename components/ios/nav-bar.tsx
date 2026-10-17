"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { GlassButton, GlassPill } from "@/components/ios/glass";
import { canPop, popBack } from "@/components/ios/nav-stack";
import { useScrollState } from "@/components/ios/scroll-state";
import { useSwipeBackTarget } from "@/components/ios/swipe-back";
import { cn } from "@/lib/utils";

export interface NavBarProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** The inline (scrolled) title's subtitle, when it differs from the large one. */
  readonly inlineSubtitle?: string | undefined;
  /**
   * Large-title screens (tab roots) show the 34pt title in the toolbar row
   * itself — left, beside the glass buttons on the right, iOS 26 style — and
   * it collapses into the centred inline title on scroll. Pushed screens are
   * inline-only. A large-title screen keeps its controls trailing; `leading`
   * is only drawn once scrolled (Обзор's calendar splitting out).
   */
  readonly large?: boolean;
  /**
   * The large title on a row of its own under the toolbar, as UIKit draws it
   * on a pushed screen: the back pill takes the leading spot (Статистика).
   */
  readonly largeBelow?: boolean;
  /**
   * Toolbar content. Pass a function to lay the toolbar out differently once
   * the large title has scrolled away — Обзор splits its glass group into a
   * leading and a trailing button (boards D01 → D02).
   */
  readonly leading?: ReactNode | ((scrolled: boolean) => ReactNode);
  readonly trailing?: ReactNode | ((scrolled: boolean) => ReactNode);
  /**
   * «‹ Ещё»: a glass back pill that pops to `href`. Without a label it is
   * the round chevron-only button the detail screens use.
   */
  readonly back?: { readonly href: string; readonly label?: string } | undefined;
  /** Inline title hidden until the content scrolls (detail screens). */
  readonly titleOnScroll?: boolean;
  readonly className?: string;
}

function render(
  slot: NavBarProps["leading"],
  scrolled: boolean,
): ReactNode {
  return typeof slot === "function" ? slot(scrolled) : slot;
}

/**
 * The navigation bar as iOS 26 draws it: no bar at all, just floating glass
 * controls over a scroll-edge fade, with the title either large in the
 * content or small and centred between the controls.
 */
export function NavBar({
  title,
  subtitle,
  inlineSubtitle,
  large = false,
  largeBelow = false,
  leading,
  trailing,
  back,
  titleOnScroll = false,
  className,
}: NavBarProps) {
  const { scrolled } = useScrollState();
  // How wide the trailing buttons are, so a large title never runs under them.
  const trailingRef = useRef<HTMLDivElement>(null);
  const [trailingWidth, setTrailingWidth] = useState(0);
  useEffect(() => {
    const element = trailingRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setTrailingWidth(element.offsetWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const router = useRouter();
  const t = useTranslations("ios");
  // A screen with a back button can also be swiped back from anywhere.
  useSwipeBackTarget(back?.href);

  const onBack = (event: React.MouseEvent<HTMLElement>) => {
    // With an in-app screen behind this one, back is a real pop to wherever
    // you came from (the list, Обзор, search…), so the button, the swipe
    // and the history agree. From a cold deep link the link pushes the
    // parent instead.
    if (back !== undefined && canPop()) {
      event.preventDefault();
      popBack(router);
    }
  };

  const lead =
    back !== undefined && (back.label === undefined || back.label === "") ? (
      <GlassButton
        icon="chevron_left"
        iconSize={28}
        label={t("back")}
        href={back.href}
        transitionTypes={["ios-pop"]}
        onClick={onBack}
      />
    ) : back !== undefined ? (
      <GlassPill
        leadingIcon="chevron_left"
        href={back.href}
        transitionTypes={["ios-pop"]}
        label={t("back")}
        onClick={onBack}
        className="pr-4 font-medium"
      >
        {back.label}
      </GlassPill>
    ) : large && !scrolled && typeof leading !== "function" ? null : (
      render(leading, scrolled)
    );

  return (
    <>
      <div
        aria-hidden
        className="ios-fixed nav-edge scroll-edge-top top-0 z-40"
        // No view-transition name: the edge belongs to its page and slides
        // with it. Named, it was pinned above a push and drew the incoming
        // page's blurred top over the outgoing page — a stuck-looking blur.
        style={{ height: "calc(var(--safe-top) + 104px)" }}
      />
      <header
        className={cn(
          // Sides never shrink below their controls; the title is centred
          // when there is room and yields (then truncates) when a wide control
          // like Бюджеты' month capsule needs it — never drawn underneath.
          "ios-fixed z-50 grid h-[52px] grid-cols-[minmax(max-content,1fr)_minmax(0,max-content)_minmax(max-content,1fr)] items-center gap-2 px-4",
          className,
        )}
        style={{ top: "calc(var(--safe-top) + 2px)" }}
      >
        <div className="flex min-w-0 items-center justify-start gap-2.5">{lead}</div>
        <div
          className={cn(
            "flex min-w-0 flex-col items-center text-center",
            (large || titleOnScroll) && "nav-inline-title",
          )}
        >
          <span className="t-headline max-w-[46vw] truncate">{title}</span>
          {(inlineSubtitle ?? subtitle) !== undefined && (
            <span className="text-label-2 t-caption max-w-[46vw] truncate">
              {inlineSubtitle ?? subtitle}
            </span>
          )}
        </div>
        <div ref={trailingRef} className="flex min-w-0 items-center justify-end gap-2.5">
          {render(trailing, scrolled)}
        </div>
      </header>

      {large ? (
        /*
         * The large title shares the toolbar's row: same top, centred on the
         * buttons' 52pt line, scrolling with the content while the buttons
         * stay put. The right padding keeps a long title clear of them.
         */
        <div
          className="nav-large-title flex flex-col px-5 pb-1"
          style={{ paddingTop: `calc(var(--safe-top) + ${largeBelow ? 66 : 7}px)` }}
        >
          <h1
            className="t-large-title truncate"
            style={{ paddingRight: largeBelow ? 0 : trailingWidth + 12 }}
          >
            {title}
          </h1>
          {/* Below the buttons' row, so it may use the full width. */}
          {subtitle !== undefined && (
            <p className="t-subhead text-label-2 mt-1.5 truncate">{subtitle}</p>
          )}
        </div>
      ) : (
        <>
          {/* The toolbar floats (top + 2, 52 tall); keep content out from under it. */}
          <div aria-hidden style={{ height: "calc(var(--safe-top) + 56px)" }} />
          <h1 className="sr-only">{title}</h1>
        </>
      )}
    </>
  );
}
