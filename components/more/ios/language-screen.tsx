"use client";

import { useOptimistic, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/app/actions/locale";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/locale";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { ListRow } from "@/components/ios/list";
import { Footnote } from "@/components/more/ios/parts";
import { cn } from "@/lib/utils";

/**
 * Each option's caption in its own language, like its name (LOCALE_NAMES):
 * someone who landed in the wrong language is looking for the words they
 * can read, not a translation of them.
 */
const SELF_CAPTION: Readonly<Record<Locale, string>> = {
  ru: "язык интерфейса",
  en: "interface language",
};

/** Russian first, as on the board — it is the household's language. */
const ORDER: readonly Locale[] = ["ru", ...LOCALES.filter((locale) => locale !== "ru")];

/**
 * Язык (boards EL09 / E09). The tick moves at once (optimistic); the cookie
 * write and the re-render of every string follow from the server action.
 */
export function LanguageScreen() {
  const t = useTranslations("ios.more.language");
  const tm = useTranslations("ios.more");
  const current = useLocale() as Locale;
  const [shown, setShown] = useOptimistic(current);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: tm("title") }} />

      <ScreenBody className="gap-[22px] pt-2">
        <div className="inset-group" aria-busy={pending}>
          {ORDER.map((locale) => {
            const selected = locale === shown;
            return (
              <ListRow
                key={locale}
                title={<span className={cn(selected && "font-semibold")}>{LOCALE_NAMES[locale]}</span>}
                subtitle={SELF_CAPTION[locale]}
                tile={
                  <span
                    aria-hidden
                    className="bg-ios-fill text-label-2 grid h-6 w-[34px] shrink-0 place-items-center rounded-[6px] text-[11px] font-bold tracking-[0.05em]"
                  >
                    {locale.toUpperCase()}
                  </span>
                }
                accessory={selected ? "check" : "none"}
                onClick={() => {
                  if (locale === shown) return;
                  startTransition(async () => {
                    setShown(locale);
                    await setLocale(locale);
                  });
                }}
              />
            );
          })}
        </div>
        <Footnote>{t("footnote")}</Footnote>
      </ScreenBody>
    </>
  );
}
