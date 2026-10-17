"use client";

import { Reorder, useDragControls } from "motion/react";
import { useTranslations } from "next-intl";
import type { SymbolName } from "@/lib/symbols";
import type { StatsChart, StatsChartPrefs } from "@/lib/stats-charts";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassPill } from "@/components/ios/glass";
import { Switch } from "@/components/ios/controls";
import { SymbolTile } from "@/components/ios/list";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

const TILES: Readonly<Record<StatsChart, { readonly icon: SymbolName; readonly color: string }>> = {
  pace: { icon: "show_chart", color: "var(--ios-tint)" },
  categories: { icon: "interests", color: "#eb6834" },
  merchants: { icon: "storefront", color: "#e5484d" },
  when: { icon: "calendar_month", color: "#4b3fb8" },
  fixed: { icon: "stacked_bar_chart", color: "#1baf7a" },
  members: { icon: "group", color: "var(--ios-pink)" },
  savings: { icon: "savings", color: "var(--ios-green)" },
  budgets: { icon: "donut_large", color: "#2a78d6" },
  networth: { icon: "account_balance", color: "var(--ios-gray)" },
};

/**
 * Графики (board L20): which charts Статистика shows and in what order.
 * Every change applies at once to the screen behind the sheet; the drag
 * handle at the trailing edge reorders, the switch hides.
 */
export function StatsChartsSheet({
  open,
  onOpenChange,
  prefs,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly prefs: StatsChartPrefs;
  readonly onChange: (prefs: StatsChartPrefs) => void;
}) {
  const t = useTranslations("ios.stats");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("charts.title")}>
      <SheetHeader
        title={t("charts.title")}
        onClose={() => {
          onOpenChange(false);
        }}
        trailing={
          <GlassPill
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t("charts.done")}
          </GlassPill>
        }
      />
      <div className="flex max-h-[66dvh] flex-col gap-3 overflow-y-auto px-4 pt-3 pb-7 overscroll-contain">
        <p className="t-subhead text-label-2">{t("charts.hint")}</p>
        <Reorder.Group
          axis="y"
          values={[...prefs.order]}
          onReorder={(order: StatsChart[]) => {
            onChange({ ...prefs, order });
          }}
          className="bg-ios-card overflow-hidden rounded-[26px]"
        >
          {prefs.order.map((id) => (
            <ChartRow
              key={id}
              id={id}
              label={t(`charts.names.${id}`)}
              shown={!prefs.hidden.includes(id)}
              onToggle={(shown) => {
                onChange({
                  ...prefs,
                  hidden: shown ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id],
                });
              }}
              moveLabel={t("charts.move")}
            />
          ))}
        </Reorder.Group>
      </div>
    </Sheet>
  );
}

function ChartRow({
  id,
  label,
  shown,
  onToggle,
  moveLabel,
}: {
  readonly id: StatsChart;
  readonly label: string;
  readonly shown: boolean;
  readonly onToggle: (shown: boolean) => void;
  readonly moveLabel: string;
}) {
  const controls = useDragControls();
  const tile = TILES[id];
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="bg-ios-card relative flex items-center gap-3.5 pl-4"
    >
      <SymbolTile icon={tile.icon} color={shown ? tile.color : "var(--ios-gray)"} />
      <span className="row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-3 pr-2">
        <span className={cn("t-body min-w-0 flex-1 truncate", !shown && "text-label-2")}>{label}</span>
        <Switch checked={shown} onChange={onToggle} label={label} />
        <button
          type="button"
          aria-label={moveLabel}
          onPointerDown={(event) => {
            // The drag is the row's, not the sheet's swipe-to-dismiss.
            event.stopPropagation();
            controls.start(event);
          }}
          className="text-label-3 grid size-10 shrink-0 cursor-grab touch-none place-items-center"
        >
          <Symbol name="drag_handle" size={22} />
        </button>
      </span>
    </Reorder.Item>
  );
}
