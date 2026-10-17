import type { ReactNode } from "react";
import { getAppLockState } from "@/lib/app-lock";
import { AppLockGate } from "@/components/more/ios/app-lock-gate";

/**
 * Wraps the signed-in app in the Face ID lock.
 *
 * While the session is locked the children are not rendered at all — not
 * hidden behind the lock screen, absent from the response — so nothing of
 * the household's data reaches a locked device. (Mutations are refused
 * separately, in `authAction`.) With the lock off this renders the children
 * and a gate that only marks the session as seen.
 */
export async function AppLockBoundary({ children }: { readonly children: ReactNode }) {
  const { enabled, locked } = await getAppLockState();
  return (
    <>
      <AppLockGate enabled={enabled} locked={locked} />
      {locked ? null : children}
    </>
  );
}
