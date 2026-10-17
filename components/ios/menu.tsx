"use client";

import { Menu } from "@base-ui/react/menu";
import { useState, type ReactElement, type ReactNode } from "react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import { useCloseWhenHidden } from "@/components/ios/close-when-hidden";
import { cn } from "@/lib/utils";

export interface MenuItemSpec {
  readonly key: string;
  readonly label: ReactNode;
  readonly sublabel?: ReactNode;
  readonly icon?: SymbolName;
  readonly checked?: boolean;
  readonly destructive?: boolean;
  readonly submenu?: boolean;
  readonly onSelect: () => void;
}

export type MenuEntry = MenuItemSpec | "separator";

/**
 * A Liquid Glass pull-down menu that grows out of the button that opened it
 * (scale from `--transform-origin`, spring, a touch of blur on the way in).
 * Rows are title-left/glyph-right like UIMenu; a «checked» menu leaves a
 * leading gutter for the tick on every row so labels stay aligned.
 */
export function GlassMenu({
  trigger,
  entries,
  align = "end",
  label,
}: {
  readonly trigger: ReactElement;
  readonly entries: readonly MenuEntry[];
  readonly align?: "start" | "center" | "end";
  readonly label: string;
}) {
  const checkable = entries.some((entry) => entry !== "separator" && entry.checked !== undefined);
  // Controlled only so it can be closed when its screen is put away.
  const [open, setOpen] = useState(false);
  useCloseWhenHidden(open, () => {
    setOpen(false);
  });
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <Menu.Trigger render={trigger} aria-label={label} />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align={align} sideOffset={-48} className="z-[70]">
          <Menu.Popup className="glass glass-strong ios-menu min-w-[244px] overflow-hidden rounded-[28px] py-2 outline-none">
            {entries.map((entry, index) =>
              entry === "separator" ? (
                <Menu.Separator key={`sep-${index}`} className="bg-ios-fill-3 my-0 h-2" />
              ) : (
                <Menu.Item
                  key={entry.key}
                  onClick={entry.onSelect}
                  className={cn(
                    "flex min-h-11 cursor-default items-center gap-2 py-1.5 pr-[18px] outline-none select-none data-[highlighted]:bg-ios-fill-3",
                    checkable ? "pl-3.5" : "pl-5",
                    entry.destructive === true ? "text-ios-red" : "text-label",
                  )}
                >
                  {checkable && (
                    <Symbol
                      name="check"
                      size={19}
                      weight={600}
                      className={entry.checked === true ? "" : "opacity-0"}
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("t-body truncate", entry.checked === true && "font-semibold")}>
                      {entry.label}
                    </span>
                    {entry.sublabel !== undefined && (
                      <span className="t-footnote text-label-2 truncate">{entry.sublabel}</span>
                    )}
                  </span>
                  {entry.submenu === true && (
                    <Symbol name="chevron_right" size={18} weight={600} className="text-label-3" />
                  )}
                  {entry.icon !== undefined && <Symbol name={entry.icon} size={21} />}
                </Menu.Item>
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
