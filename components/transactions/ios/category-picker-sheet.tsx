"use client";

import { useTranslations } from "next-intl";
import { categorySymbol } from "@/lib/symbols";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

export interface PickerCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly icon: string;
  readonly color: string;
  readonly kind: "income" | "expense";
}

/**
 * «Сменить категорию»: every category of the row's kind as round colour
 * tiles, four to a row, the current one ringed — the same tiles the entry
 * sheet uses, so choosing a category looks the same everywhere.
 */
export function CategoryPickerSheet({
  open,
  onOpenChange,
  categories,
  kind,
  selectedId,
  onPick,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly categories: readonly PickerCategory[];
  readonly kind: "income" | "expense";
  readonly selectedId: string | null;
  readonly onPick: (id: string) => void;
}) {
  const t = useTranslations("ios.tx");
  const list = categories.filter((category) => category.kind === kind);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("changeCategory")}>
      <SheetHeader
        title={t("changeCategory")}
        onClose={() => {
          onOpenChange(false);
        }}
      />
      <div className="grid max-h-[60dvh] grid-cols-4 gap-x-1 gap-y-4 overflow-y-auto px-4 pt-4 pb-8">
        {list.map((category) => {
          const selected = category.id === selectedId;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                onPick(category.id);
                onOpenChange(false);
              }}
              className="press flex flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "grid size-[60px] place-items-center rounded-full border-[2.5px]",
                  selected ? "" : "border-transparent",
                )}
                style={selected ? { borderColor: category.color } : undefined}
              >
                <span
                  className="grid size-[50px] place-items-center rounded-full text-white"
                  style={{ backgroundColor: category.color }}
                >
                  <Symbol name={categorySymbol(category.icon, category.slug)} size={26} weight={600} />
                </span>
              </span>
              <span
                className={cn(
                  "t-caption w-full truncate text-center",
                  selected ? "text-label font-semibold" : "text-label-2 font-medium",
                )}
              >
                {category.name}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
