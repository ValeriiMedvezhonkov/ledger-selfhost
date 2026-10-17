"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { ListRow } from "@/components/ios/list";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import {
  AppIcon,
  Footnote,
  useThemeChoice,
  useThemeLabel,
  type ThemeChoice,
} from "@/components/more/ios/parts";
import { cn } from "@/lib/utils";

const CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

/** The mini screen drawn in each tile: a page, a card, a line of text. */
function Preview({ choice }: { readonly choice: ThemeChoice }) {
  if (choice === "system") {
    return (
      <>
        <span className="absolute inset-y-0 left-0 w-1/2 bg-[#F2F2F7]" />
        <span className="absolute top-3 left-2 h-2.5 w-[35%] rounded-[4px] bg-white" />
        <span className="absolute top-7 left-2 h-1.5 w-[27%] rounded-[3px] bg-[#D9D9DE]" />
        <span className="absolute inset-y-0 right-0 w-1/2 bg-black" />
        <span className="absolute top-10 left-[calc(50%+8px)] h-2.5 w-[35%] rounded-[4px] bg-[#1C1C1E]" />
        <span className="absolute top-[54px] left-[calc(50%+8px)] h-1.5 w-[27%] rounded-[3px] bg-[#2C2C2E]" />
      </>
    );
  }
  const dark = choice === "dark";
  return (
    <>
      <span className={cn("absolute inset-0", dark ? "bg-black" : "bg-[#F2F2F7]")} />
      <span
        className={cn("absolute top-3 left-2 h-2.5 w-[59%] rounded-[4px]", dark ? "bg-[#1C1C1E]" : "bg-white")}
      />
      <span
        className={cn("absolute top-7 left-2 h-1.5 w-[43%] rounded-[3px]", dark ? "bg-[#2C2C2E]" : "bg-[#D9D9DE]")}
      />
    </>
  );
}

/**
 * Внешний вид (boards EL08 / E08): День, Ночь or Авто as three miniature
 * screens with radio labels, and the app icon — of which there is one.
 *
 * The theme is next-themes' (localStorage + the `dark` class on <html>), so
 * it is per device rather than per account: one partner's phone at night
 * should not darken the other's.
 */
export function AppearanceScreen() {
  const t = useTranslations("ios.more.appearance");
  const tm = useTranslations("ios.more");
  const { choice, setChoice } = useThemeChoice();
  const label = useThemeLabel();
  const [iconOpen, setIconOpen] = useState(false);

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: tm("title") }} />

      <ScreenBody className="gap-[22px] pt-2">
        <section className="inset-group flex flex-col gap-3.5 p-4">
          <h2 className="text-[16px] leading-[21px] font-semibold tracking-[-0.02em]">{t("theme")}</h2>
          <div role="radiogroup" aria-label={t("theme")} className="grid grid-cols-3 gap-3">
            {CHOICES.map((option) => {
              const selected = option === choice;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setChoice(option);
                  }}
                  className="press flex flex-col items-center gap-2"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "relative block h-[66px] w-full overflow-clip rounded-[14px]",
                      selected
                        ? "shadow-[0_0_0_2px_var(--ios-tint)]"
                        : "shadow-[0_0_0_1px_var(--ios-sep)]",
                    )}
                  >
                    <Preview choice={option} />
                  </span>
                  <span className="flex items-center gap-1.5">
                    {selected ? (
                      <span className="bg-tint grid size-[18px] place-items-center rounded-full text-white">
                        <Symbol name="check" size={13} weight={700} />
                      </span>
                    ) : (
                      <span className="size-[18px] rounded-full shadow-[inset_0_0_0_1.5px_var(--ios-label-3)]" />
                    )}
                    <span className={cn("text-[13px]", selected ? "text-label font-semibold" : "text-label-2")}>
                      {label(option)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <Footnote>{t("autoFootnote")}</Footnote>

        <div className="inset-group">
          <ListRow
            title={t("appIcon")}
            tile={{ icon: "apps", color: "var(--ios-tint)" }}
            value={t("classic")}
            onClick={() => {
              setIconOpen(true);
            }}
          />
        </div>
      </ScreenBody>

      <Sheet open={iconOpen} onOpenChange={setIconOpen} detent="medium" title={t("appIcon")}>
        <SheetHeader
          title={t("appIcon")}
          onClose={() => {
            setIconOpen(false);
          }}
        />
        <div className="flex flex-col items-center gap-4 px-6 pt-6 pb-10 text-center">
          <AppIcon size={76} />
          <span className="flex items-center gap-1.5">
            <span className="t-headline">{t("classic")}</span>
            <Symbol name="check_circle" size={20} filled className="text-tint" />
          </span>
          <p className="t-subhead text-label-2 max-w-[320px]">{t("iconBody")}</p>
        </div>
      </Sheet>
    </>
  );
}
