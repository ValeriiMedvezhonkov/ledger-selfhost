"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";
import { useCloseWhenHidden } from "@/components/ios/close-when-hidden";
import { cn } from "@/lib/utils";

/**
 * The iOS 26 alert: a 300pt glass card with radius 34 and capsule buttons
 * side by side — cancel in a neutral fill, the destructive action filled red.
 */
export function IosAlert({
  open,
  onOpenChange,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onConfirm,
  destructive = true,
  pending = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly message?: ReactNode;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly destructive?: boolean;
  readonly pending?: boolean;
}) {
  useCloseWhenHidden(open, () => {
    onOpenChange(false);
  });
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed-fill bg-[var(--ios-scrim)] z-[80] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup className="glass glass-strong fixed top-1/2 left-1/2 z-[81] flex w-[300px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[18px] rounded-[34px] px-[18px] pt-6 pb-[18px] text-center outline-none transition-[opacity,scale] duration-250 [--glass-tint-strong:var(--ios-card)] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-110 data-[starting-style]:opacity-0">
          <div className="flex flex-col gap-1.5">
            <AlertDialog.Title className="t-headline">{title}</AlertDialog.Title>
            {message !== undefined && (
              <AlertDialog.Description className="t-subhead text-label-2 leading-[1.3]">
                {message}
              </AlertDialog.Description>
            )}
          </div>
          <div className="flex gap-2.5">
            <AlertDialog.Close className="bg-ios-fill-3 press t-headline h-12 flex-1 rounded-full">
              {cancelLabel}
            </AlertDialog.Close>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className={cn(
                "press t-headline h-12 flex-1 rounded-full disabled:opacity-60",
                destructive ? "bg-ios-red text-white" : "bg-tint text-white",
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
