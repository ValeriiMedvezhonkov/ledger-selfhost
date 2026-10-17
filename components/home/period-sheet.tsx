"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { toISODate } from "@/lib/date";
import { useFormats } from "@/hooks/use-formats";
import { SheetCalendar } from "@/components/ios/sheet-calendar";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassButton, ProminentButton } from "@/components/ios/glass";

/**
 * «Выбрать даты…» from the period menu: a medium glass sheet holding a range
 * calendar. Both ends are held locally and committed to the URL together —
 * pushing the first click would re-render the page under the sheet (see the
 * range-picker notes in NOTES.md).
 */
export function PeriodSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("ios.home");
  const f = useFormats();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const apply = () => {
    if (range?.from === undefined || range.to === undefined) return;
    const next = new URLSearchParams(params.toString());
    next.set("period", "custom");
    next.set("from", toISODate(range.from));
    next.set("to", toISODate(range.to));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("periods.custom")}>
      <SheetHeader
        title={t("periods.custom")}
        onClose={() => {
          onOpenChange(false);
        }}
        trailing={
          <GlassButton
            icon="check"
            label={t("apply")}
            tinted
            disabled={range?.from === undefined || range.to === undefined}
            onClick={apply}
          />
        }
      />
      <div className="px-4 pt-2 pb-2">
        <SheetCalendar
          mode="range"
          selected={range}
          onSelect={setRange}
          locale={f.calendar}
        />
      </div>
      <div className="px-4 pb-7">
        <ProminentButton
          onClick={apply}
          disabled={range?.from === undefined || range.to === undefined}
        >
          {t("apply")}
        </ProminentButton>
      </div>
    </Sheet>
  );
}
