import { requireUser } from "@/lib/auth";
import { AddTransactionProvider } from "@/components/transactions/add-transaction";
import { SessionKeeper } from "@/components/security/session-keeper";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ScrollStateProvider } from "@/components/ios/scroll-state";
import { TabAccessoryProvider } from "@/components/ios/tab-bar";
import { AppTabBar } from "@/components/ios/app-tab-bar";
import { NavStackTracker } from "@/components/ios/nav-stack";
import { SwipeBack } from "@/components/ios/swipe-back";
import { LiquidLens } from "@/components/ios/liquid-lens";
import { AppLockBoundary } from "@/components/more/ios/app-lock-boundary";

/**
 * The app shell, iOS 27 style: no sidebar and no header bar. Each screen
 * draws its own floating glass toolbar and title (components/ios/nav-bar),
 * the document scrolls underneath, and the glass tab bar floats over the
 * bottom of every screen. Wider than a phone, the same UI renders in a
 * centred 440px column — one interface, not two layouts drifting apart.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();

  return (
    <ScrollStateProvider>
      <TabAccessoryProvider>
        <AddTransactionProvider>
          <PullToRefresh />
          <NavStackTracker />
          <SwipeBack />
          <LiquidLens />
          <main className="bg-ios-bg min-h-screen-ios">
            {/* Face ID lock: while locked, the page is not rendered at all. */}
            <AppLockBoundary>{children}</AppLockBoundary>
          </main>
          <AppTabBar />
          <SessionKeeper />
        </AddTransactionProvider>
      </TabAccessoryProvider>
    </ScrollStateProvider>
  );
}
