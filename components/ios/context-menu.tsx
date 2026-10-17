"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { SymbolName } from "@/lib/symbols";
import { Symbol } from "@/components/ios/symbol";
import type { MenuEntry } from "@/components/ios/menu";
import { cn } from "@/lib/utils";
import { useCloseWhenHidden } from "@/components/ios/close-when-hidden";

export interface QuickAction {
  readonly key: string;
  readonly label: string;
  readonly icon: SymbolName;
  readonly onSelect: () => void;
}

const HOLD_MS = 430;
const noopSubscribe = () => () => undefined;
const SLOP = 8;
const MENU_WIDTH = 260;

/**
 * Long-press (touch) or right-click (pointer) context menu, iOS style: the
 * page blurs and dims, the pressed row lifts out of it at its own position,
 * and a glass menu with a row of quick actions opens beside it.
 *
 * Built by hand rather than on a menu primitive because the lifted preview —
 * the row itself, raised above the blur, exactly where your finger was — is
 * the point of the interaction, and no primitive renders that.
 */
export function ContextMenuTarget({
  children,
  entries,
  quickActions = [],
  className,
}: {
  readonly children: ReactNode;
  readonly entries: readonly MenuEntry[];
  readonly quickActions?: readonly QuickAction[];
  readonly className?: string;
}) {
  const t = useTranslations("ios");
  // Portals exist only on the client; this is false during hydration.
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const openAt = useCallback(() => {
    const element = ref.current;
    if (element === null) return;
    suppressClick.current = true;
    setRect(element.getBoundingClientRect());
  }, []);

  const close = useCallback(() => {
    setRect(null);
  }, []);
  useCloseWhenHidden(rect !== null, close);

  useEffect(() => {
    if (rect === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
    };
  }, [rect, close]);

  const run = (action: () => void) => {
    close();
    // Let the menu leave before the action re-renders the list under it.
    window.setTimeout(action, 160);
  };

  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  const below = rect !== null && rect.bottom + 12 + 380 < viewportH;
  const menuTop = rect === null ? 0 : below ? rect.bottom + 12 : Math.max(60, rect.top - 12 - 380);
  const menuLeft = rect === null ? 0 : Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12);

  return (
    <>
      <div
        ref={ref}
        className={cn("no-callout", className)}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          origin.current = { x: event.clientX, y: event.clientY };
          timer.current = window.setTimeout(() => {
            timer.current = null;
            openAt();
          }, HOLD_MS);
        }}
        onPointerMove={(event) => {
          if (origin.current === null) return;
          if (
            Math.abs(event.clientX - origin.current.x) > SLOP ||
            Math.abs(event.clientY - origin.current.y) > SLOP
          ) {
            cancel();
          }
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => {
          event.preventDefault();
          cancel();
          openAt();
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </div>

      {isClient &&
        createPortal(
          <AnimatePresence>
            {rect !== null && (
              <motion.div
                key="ctx"
                className="fixed-fill z-[75]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  aria-label={t("close")}
                  onClick={close}
                  className="absolute inset-0 bg-black/5 backdrop-blur-[22px] dark:bg-black/30"
                />
                <motion.div
                  aria-hidden
                  className="bg-ios-card pointer-events-none absolute overflow-hidden rounded-[22px] shadow-[0_16px_40px_rgb(0_0_0/0.2)]"
                  style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                  initial={{ scale: 1 }}
                  animate={{ scale: 1.03 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                >
                  {children}
                </motion.div>
                <motion.div
                  role="menu"
                  className="glass glass-strong absolute overflow-hidden rounded-[28px] py-2"
                  style={{
                    top: menuTop,
                    left: menuLeft,
                    width: MENU_WIDTH,
                    transformOrigin: below ? "top left" : "bottom left",
                  }}
                  initial={{ scale: 0.6, opacity: 0, filter: "blur(6px)" }}
                  animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 32 }}
                >
                  {quickActions.length > 0 && (
                    <div className="flex gap-1.5 px-2 pt-1 pb-2">
                      {quickActions.map((action) => (
                        <button
                          key={action.key}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            run(action.onSelect);
                          }}
                          className="bg-ios-fill-3 press flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-[18px]"
                        >
                          <Symbol name={action.icon} size={22} />
                          <span className="t-caption font-medium">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {entries.map((entry, index) =>
                    entry === "separator" ? (
                      <div key={`sep-${index}`} className="bg-ios-fill-3 h-2" />
                    ) : (
                      <button
                        key={entry.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          run(entry.onSelect);
                        }}
                        className={cn(
                          "press-row flex h-[46px] w-full items-center gap-2.5 px-5 text-left",
                          entry.destructive === true ? "text-ios-red" : "text-label",
                        )}
                      >
                        <span className="t-body min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.submenu === true && (
                          <Symbol name="chevron_right" size={18} weight={600} className="text-label-3" />
                        )}
                        {entry.icon !== undefined && <Symbol name={entry.icon} size={21} />}
                      </button>
                    ),
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
