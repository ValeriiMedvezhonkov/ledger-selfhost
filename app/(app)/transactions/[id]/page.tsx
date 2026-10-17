import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import {
  getMerchantHistory,
  getTransactionDetail,
  listCategories,
} from "@/lib/queries";
import { Screen } from "@/components/ios/screen";
import { TransactionDetailView } from "@/components/transactions/ios/transaction-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.detail");
  return { title: t("title") };
}

/** Операция · детали (boards L04 / D04, alert L12). Pushed from any row. */
export default async function TransactionDetailPage(
  props: PageProps<"/transactions/[id]">,
) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const now = serverNow();
  const detail = await getTransactionDetail(user.householdId, id);
  if (detail === null) notFound();

  const [history, categories] = await Promise.all([
    detail.merchant === null || detail.isTransfer
      ? Promise.resolve(null)
      : getMerchantHistory(user.householdId, detail.merchant, now, 6),
    listCategories(user.householdId),
  ]);

  return (
    <Screen>
      <TransactionDetailView
        detail={detail}
        history={history}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          color: c.color,
          kind: c.kind,
        }))}
      />
    </Screen>
  );
}
