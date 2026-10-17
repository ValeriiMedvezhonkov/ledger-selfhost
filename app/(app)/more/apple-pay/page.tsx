import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { todayISO } from "@/lib/date";
import { getTransactionDetail, listAccounts } from "@/lib/queries";
import { getWalletStatus } from "@/lib/wallet";
import { Screen } from "@/components/ios/screen";
import { ApplePayScreen, type LastTap } from "@/components/more/ios/apple-pay-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.more.rows");
  return { title: t("applePay") };
}

/** Apple Pay (boards EL07 / E07), pushed from Ещё. */
export default async function ApplePayPage() {
  const user = await requireUser();
  const today = todayISO(serverNow());
  const [status, accounts] = await Promise.all([
    getWalletStatus(user.householdId),
    listAccounts(user.householdId),
  ]);

  // The status names the last tap; the detail query adds what the row draws
  // (category glyph and colour, currency, the calendar day).
  const detail =
    status.lastTransaction === null
      ? null
      : await getTransactionDetail(user.householdId, status.lastTransaction.id);
  const lastTap: LastTap | null =
    detail === null
      ? null
      : {
          id: detail.id,
          merchant: detail.merchant,
          amountMinor: detail.amountMinor,
          currency: detail.currency,
          occurredOn: detail.occurredOn,
          occurredAt: detail.occurredAt,
          categoryName: detail.categoryName,
          categoryIcon: detail.categoryIcon,
          categorySlug: detail.categorySlug,
          categoryColor: detail.categoryColor,
        };

  // A refusal only matters until a tap gets through after it.
  const errorIsCurrent =
    status.lastError !== null &&
    status.lastErrorAt !== null &&
    (status.lastReceivedAt === null || status.lastErrorAt > status.lastReceivedAt);

  return (
    <Screen>
      <ApplePayScreen
        configured={status.configured}
        secretSource={status.secretSource}
        secretHint={status.secretHint}
        lastError={errorIsCurrent ? status.lastError : null}
        defaultAccountId={status.defaultAccount?.id ?? null}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        lastTap={lastTap}
        today={today}
        email={user.email}
      />
    </Screen>
  );
}
