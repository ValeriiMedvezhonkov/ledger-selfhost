"use client";

import { useLocale, useTranslations } from "next-intl";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * A rule's schedule in words, the way a person says it: «1-го числа»,
 * «по понедельникам», «каждый год 5 мая», «раз в 2 месяца, 1-го числа».
 *
 * The anchor is the start date, not the next run: a rule that started on the
 * 31st keeps saying «31-го числа» in a 30-day month, when date-fns clamps that
 * month's run to the 30th.
 */
export function useSchedule() {
  const t = useTranslations("ios.recurring");
  const locale = useLocale();
  const yearly = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" });

  return (rule: {
    readonly frequency: Frequency;
    readonly interval: number;
    readonly startOn: string;
  }): string => {
    // Noon, so no timezone can push the calendar day across midnight.
    const anchor = new Date(`${rule.startOn}T12:00:00`);
    const interval = Math.max(1, rule.interval);
    switch (rule.frequency) {
      case "daily":
        return t("schedule.daily", { interval });
      case "weekly":
        return t("schedule.weekly", {
          interval,
          day: t(`weekdays.${WEEKDAYS[anchor.getDay()] ?? "mon"}`),
        });
      case "monthly":
        return t("schedule.monthly", { interval, day: anchor.getDate() });
      case "yearly":
        return t("schedule.yearly", { interval, date: yearly.format(anchor) });
    }
  };
}
