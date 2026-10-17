"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import type { PeriodKey } from "@/lib/periods";
import { NavBar } from "@/components/ios/nav-bar";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import { MemberAvatar } from "@/components/ios/controls";
import { PeriodSheet } from "@/components/home/period-sheet";

const spring = { type: "spring", stiffness: 480, damping: 38, mass: 0.9 } as const;

export interface HomeToolbarProps {
  readonly title: string;
  readonly subtitle: string;
  readonly inlineSubtitle: string;
  readonly period: PeriodKey;
  readonly monthRangeLabel: string;
  readonly members: readonly { readonly id: string; readonly name: string; readonly color: string }[];
}

/**
 * Обзор's toolbar, the one that rearranges itself on scroll (boards D01 → D02).
 *
 * At rest: a glass group [period · search] and the household's avatars on the
 * trailing side, the large title below. Scrolled: the avatars leave, the
 * group gives up its calendar to a circle of its own on the leading side, the
 * rest of the capsule shrinks to the search circle, and the title moves into
 * the middle. Each moving glyph keeps one layoutId across both layouts, so
 * motion animates them along their real paths instead of cross-fading two
 * unrelated toolbars.
 */
export function HomeToolbar({
  title,
  subtitle,
  inlineSubtitle,
  period,
  monthRangeLabel,
  members,
}: HomeToolbarProps) {
  const t = useTranslations("ios.home");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [picking, setPicking] = useState(false);

  const setPeriod = (key: PeriodKey) => {
    const next = new URLSearchParams(params.toString());
    if (key === "month") next.delete("period");
    else next.set("period", key);
    next.delete("from");
    next.delete("to");
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  };

  const periodMenu = (trigger: ReactElement) => (
    <GlassMenu
      label={t("period")}
      trigger={trigger}
      align="end"
      entries={[
        {
          key: "month",
          label: t("periods.month"),
          sublabel: monthRangeLabel,
          checked: period === "month",
          onSelect: () => {
            setPeriod("month");
          },
        },
        { key: "last", label: t("periods.last"), checked: period === "last", onSelect: () => { setPeriod("last"); } },
        { key: "quarter", label: t("periods.quarter"), checked: period === "quarter", onSelect: () => { setPeriod("quarter"); } },
        { key: "year", label: t("periods.year"), checked: period === "year", onSelect: () => { setPeriod("year"); } },
        "separator",
        {
          key: "custom",
          label: t("periods.custom"),
          icon: "date_range",
          checked: period === "custom",
          onSelect: () => {
            setPicking(true);
          },
        },
      ]}
    />
  );

  const calendarIcon = (
    <motion.span layoutId="home-cal-glyph" transition={spring} className="grid place-items-center">
      <Symbol name="calendar_month" size={22} />
    </motion.span>
  );
  const searchIcon = (
    <motion.span layoutId="home-search-glyph" transition={spring} className="grid place-items-center">
      <Symbol name="search" size={22} />
    </motion.span>
  );

  return (
    <>
    <PeriodSheet open={picking} onOpenChange={setPicking} />
    <NavBar
      large
      title={title}
      subtitle={subtitle}
      leading={(scrolled) => (
        <AnimatePresence initial={false}>
          {scrolled && (
            <motion.div
              key="cal-circle"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={spring}
              className="glass size-12 rounded-full"
            >
              {periodMenu(
                <button type="button" className="press text-label grid size-12 place-items-center">
                  {calendarIcon}
                </button>,
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      trailing={(scrolled) => (
        <div className="flex items-center gap-2.5">
          <motion.div
            layoutId="home-group"
            transition={spring}
            className="glass text-label flex h-12 items-center rounded-full"
            style={{ paddingInline: scrolled ? 0 : 6 }}
          >
            {!scrolled &&
              periodMenu(
                <button type="button" className="press grid h-12 w-[42px] place-items-center rounded-full">
                  {calendarIcon}
                </button>,
              )}
            <Link
              href="/transactions?search=1"
              transitionTypes={["ios-push"]}
              aria-label={t("search")}
              className="press grid h-12 place-items-center rounded-full"
              style={{ width: scrolled ? 48 : 42 }}
            >
              {searchIcon}
            </Link>
          </motion.div>
          <AnimatePresence initial={false}>
            {!scrolled && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4, width: 0, marginLeft: -10 }}
                transition={spring}
              >
                <Link
                  href="/more/household"
                  transitionTypes={["ios-push"]}
                  aria-label={t("household")}
                  className="glass press grid size-12 place-items-center rounded-full"
                >
                  <span className="flex -space-x-2">
                    {members.map((member) => (
                      <MemberAvatar
                        key={member.id}
                        name={member.name}
                        color={member.color}
                        size={24}
                        ring="#ffffff"
                      />
                    ))}
                  </span>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      inlineSubtitle={inlineSubtitle}
    />
    </>
  );
}
