"use client";

import { Drawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { GlassButton } from "@/components/ios/glass";
import { useCloseWhenHidden } from "@/components/ios/close-when-hidden";
import { cn } from "@/lib/utils";

/** The on-screen keyboard's height while a field in the sheet has focus. */
const KEYBOARD = "var(--drawer-keyboard-inset, 0px)";

/** The gap under a floating sheet: just clear of the home indicator. */
const SHEET_BOTTOM = "max(8px, calc(var(--safe-bottom) - 26px))";

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Both float inset from the screen edges as Liquid Glass with
   * display-concentric corners, as iOS 26 draws sheets. `large` is the
   * full-height one (Новая запись, editors); `medium` sizes to its content
   * (Фильтры).
   */
  readonly detent?: "medium" | "large";
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly onClosed?: () => void;
}

/**
 * The iOS 26 sheet, built on Base UI's Drawer (swipe-to-dismiss, focus trap,
 * scroll lock, keyboard inset). Swipe progress drives both the sheet and the
 * backdrop through Base UI's CSS variables, so a half-dismissed sheet fades
 * the scrim proportionally like UIKit's.
 */
export function Sheet({
  open,
  onOpenChange,
  detent = "large",
  title,
  children,
  className,
  onClosed,
}: SheetProps) {
  useCloseWhenHidden(open, () => {
    onOpenChange(false);
  });
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.();
      }}
    >
      {/*
       * Keyboard-aware: with a text field focused, Base UI measures the
       * on-screen keyboard (--drawer-keyboard-inset on the viewport) and
       * scrolls the focused field into view inside the sheet. The viewport
       * lifts the sheet clear of the keyboard and the sheet gives up that
       * height, so its header (✓ included) stays on screen and the content
       * scrolls under it — instead of iOS sliding the whole sheet up behind
       * the keyboard and the field ending up covered.
       */}
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="ios-sheet-backdrop fixed-fill z-[60]" />
          <Drawer.Viewport
            className="fixed-fill pointer-events-none z-[61] flex items-end justify-center"
            style={{ paddingBottom: KEYBOARD }}
          >
            <Drawer.Popup
              className={cn(
                // overflow-hidden: content with its own fill (the entry sheet's
                // keypad tray) follows the rounded corners instead of poking out.
                "ios-sheet glass glass-strong pointer-events-auto mx-2 flex w-[calc(100%-16px)] max-w-[424px] flex-col overflow-hidden rounded-t-[36px] rounded-b-[54px] outline-none",
                className,
              )}
              style={
                detent === "large"
                  ? {
                      height: `calc(100dvh + var(--vp-fix) - var(--safe-top) - 10px - ${SHEET_BOTTOM} - ${KEYBOARD})`,
                      marginBottom: SHEET_BOTTOM,
                    }
                  : {
                      maxHeight: `calc(100dvh + var(--vp-fix) - var(--safe-top) - 24px - ${KEYBOARD})`,
                      marginBottom: SHEET_BOTTOM,
                    }
              }
            >
              <div
                aria-hidden
                className="flex h-4 shrink-0 items-center justify-center"
              >
                <span className="bg-label-3 h-[5px] w-9 rounded-full" />
              </div>
              <Drawer.Title className="sr-only">{title}</Drawer.Title>
              {children}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}

/** Close · Title · trailing action, the header row every sheet uses. */
export function SheetHeader({
  title,
  onClose,
  trailing,
}: {
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly trailing?: ReactNode;
}) {
  const t = useTranslations("ios");
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
      <div className="flex justify-start">
        <GlassButton icon="close" label={t("close")} onClick={onClose} />
      </div>
      <span className="t-headline truncate">{title}</span>
      <div className="flex justify-end">{trailing}</div>
    </div>
  );
}
