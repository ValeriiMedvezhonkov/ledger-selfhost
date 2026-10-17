import { ViewTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One screen of the app.
 *
 * The push/pop slide is not done here: it animates the root snapshot by
 * transition type (app/ios.css), so no screen is ever captured as a separate,
 * page-tall view-transition image. The <ViewTransition> stays, opted out of
 * every animation, so a navigation remains an animatable React transition
 * without this subtree claiming a name of its own.
 */
export function Screen({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <ViewTransition default="none">
      <div
        className={cn(
          "bg-ios-bg relative mx-auto min-h-screen-ios w-full max-w-[440px]",
          className,
        )}
      >
        {children}
      </div>
    </ViewTransition>
  );
}

/** Padded content column; clears the floating tab bar at the bottom. */
export function ScreenBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-[22px] px-4 pt-4", className)}
      style={{ paddingBottom: "calc(var(--safe-bottom) + 120px)" }}
    >
      {children}
    </div>
  );
}
