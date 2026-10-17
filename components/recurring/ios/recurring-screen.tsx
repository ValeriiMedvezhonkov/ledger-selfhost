"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RecurringWithNames } from "@/lib/queries";
import type { ISODate } from "@/lib/date";
import { categorySymbol } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton } from "@/components/ios/glass";
import { ListRow, SymbolTile } from "@/components/ios/list";
import { Symbol } from "@/components/ios/symbol";
import type { PickerCategory } from "@/components/transactions/ios/category-picker-sheet";
import { useSchedule } from "@/components/recurring/ios/schedule";
import {
  RuleSheet,
  type RuleAccount,
  type RuleMember,
} from "@/components/recurring/ios/rule-sheet";
import { cn } from "@/lib/utils";

/**
 * Регулярные (board EL05). One inset group of rules — category tile, name,
 * «category · schedule in words», the amount over «след. 1 ноя» — with paused
 * rules dimmed and marked «На паузе»; a footnote saying what a rule does, and
 * an add row. A tap opens the rule in the edit sheet.
 */
export function RecurringScreen({
  rules,
  accounts,
  categories,
  members,
  currentUserId,
  baseCurrency,
  today,
}: {
  readonly rules: readonly RecurringWithNames[];
  readonly accounts: readonly RuleAccount[];
  readonly categories: readonly PickerCategory[];
  readonly members: readonly RuleMember[];
  readonly currentUserId: string;
  readonly baseCurrency: string;
  readonly today: ISODate;
}) {
  const t = useTranslations("ios.recurring");
  const f = useFormats();
  const schedule = useSchedule();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<RecurringWithNames | null>(null);
  const [formKey, setFormKey] = useState(0);

  const edit = (rule: RecurringWithNames | null) => {
    setShown(rule);
    setFormKey((key) => key + 1);
    setOpen(true);
  };

  return (
    <>
      <NavBar
        title={t("title")}
        back={{ href: "/more", label: t("more") }}
        trailing={
          <GlassButton
            icon="add"
            iconSize={26}
            label={t("add")}
            onClick={() => {
              edit(null);
            }}
          />
        }
      />

      <ScreenBody className="gap-[18px] pt-3">
        {rules.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="t-footnote text-label-2 px-4 uppercase">
              {t("rules", { count: rules.length })}
            </h2>
            <div className="inset-group">
              {rules.map((rule) => {
                // A rule past its end date stays listed but will not run again.
                const ended = rule.endOn !== null && rule.nextRunOn > rule.endOn;
                const dim = !rule.active || ended;
                const subtitle = !rule.active
                  ? t("paused")
                  : [rule.categoryName, schedule(rule)]
                      .filter((part): part is string => part !== null && part !== "")
                      .join(" · ");
                const income = rule.amountMinor > 0;
                return (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => {
                      edit(rule);
                    }}
                    className="press-row flex min-h-16 w-full items-center gap-3 pl-4 text-left"
                  >
                    <SymbolTile
                      icon={
                        rule.categoryId === null
                          ? "event_repeat"
                          : categorySymbol(rule.categoryIcon, rule.categorySlug)
                      }
                      color={rule.categoryColor ?? "var(--ios-blue)"}
                      size={40}
                      className={cn(dim && "opacity-55")}
                    />
                    <span className="row-sep flex min-h-16 min-w-0 flex-1 items-center gap-2 self-stretch py-2.5 pr-4">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("t-headline truncate", dim && "text-label-2")}>
                          {rule.name}
                        </span>
                        <span
                          className={cn(
                            "truncate text-[14px] leading-[18px] tracking-[-0.006em]",
                            rule.active ? "text-label-2" : "text-ios-orange",
                          )}
                        >
                          {subtitle}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-[3px]">
                        <span
                          className={cn(
                            "money t-headline whitespace-nowrap",
                            dim ? "text-label-3" : income && "text-ios-green",
                          )}
                        >
                          {minus(f.money(rule.amountMinor, rule.currency, { signed: true }))}
                        </span>
                        {rule.active && (
                          <span className="t-footnote text-label-2 whitespace-nowrap">
                            {ended ? t("ended") : t("next", { date: f.dateShort(rule.nextRunOn) })}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="t-footnote text-label-2 px-4 pt-1 leading-[1.35]">{t("footnote")}</p>
          </section>
        ) : (
          <div className="inset-group flex flex-col items-center gap-3 p-6 text-center">
            <Symbol name="event_repeat" size={44} className="text-label-3" />
            <p className="t-headline">{t("emptyTitle")}</p>
            <p className="t-subhead text-label-2">{t("emptyBody")}</p>
          </div>
        )}

        <div className="inset-group">
          <ListRow
            title={t("addRow")}
            tinted
            accessory="none"
            tile={<SymbolTile icon="add" color="var(--ios-tint-soft)" className="text-tint" />}
            onClick={() => {
              edit(null);
            }}
          />
        </div>
      </ScreenBody>

      <RuleSheet
        open={open}
        onOpenChange={setOpen}
        formKey={formKey}
        rule={shown}
        accounts={accounts}
        categories={categories}
        members={members}
        currentUserId={currentUserId}
        baseCurrency={baseCurrency}
        today={today}
      />
    </>
  );
}
