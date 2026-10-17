"use client";

import Image from "next/image";
import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Small pieces the Ещё stack shares. They stay here rather than in the iOS
 * kit because only these screens draw them this way.
 */

/**
 * The grey caption under a card on the Ещё boards (EL01, EL08, EL09): 12pt,
 * tertiary label, aligned with the card's edge rather than indented like a
 * UITableView footer.
 */
export function Footnote({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <p className={cn("text-label-3 -mt-2 px-1 text-[12px] leading-[1.45]", className)}>
      {children}
    </p>
  );
}

const emptySubscribe = () => () => undefined;

/**
 * "Am I hydrated?" without an effect writing state. The server cannot know
 * the theme next-themes keeps in localStorage, so anything that names it
 * waits one frame instead of risking a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export type ThemeChoice = "light" | "dark" | "system";

function asChoice(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * The stored theme as the three options the Внешний вид screen offers, or
 * null before hydration. «Авто» is next-themes' "system": it follows the
 * device, which on iOS is the light-by-day, dark-by-night schedule.
 */
export function useThemeChoice(): {
  readonly choice: ThemeChoice | null;
  readonly setChoice: (choice: ThemeChoice) => void;
} {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  return { choice: hydrated ? asChoice(theme) : null, setChoice: setTheme };
}

/** «День» / «Ночь» / «Авто», for the row value on Ещё and the radio labels. */
export function useThemeLabel(): (choice: ThemeChoice) => string {
  const t = useTranslations("ios.more.appearance");
  return (choice) =>
    choice === "light" ? t("light") : choice === "dark" ? t("dark") : t("auto");
}

/**
 * The app's icon as the home screen shows it: the same Receipt art as
 * app/apple-icon.png (public/icon-512.png), with the corner rounding iOS
 * would apply.
 */
export function AppIcon({ size = 76 }: { readonly size?: number }) {
  return (
    <Image
      src="/icon-512.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className="shrink-0 shadow-[0_10px_30px_rgb(94_92_230/0.35)]"
      style={{ borderRadius: size * 0.225 }}
    />
  );
}
