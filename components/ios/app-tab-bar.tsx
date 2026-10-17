"use client";

import { useAddTransaction } from "@/components/transactions/add-transaction";
import { TabBar } from "@/components/ios/tab-bar";

/** The tab bar, wired to the global «Новая запись» sheet. */
export function AppTabBar() {
  const compose = useAddTransaction();
  return <TabBar onCompose={compose.open} />;
}
