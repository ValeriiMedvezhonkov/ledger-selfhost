"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { format } from "date-fns";
import type { MerchantHistory, TransactionDetail } from "@/lib/queries";
import { categorySymbol, type SymbolName } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import {
  changeTransactionCategory,
  deleteTransaction,
  makeTransactionRecurring,
} from "@/app/(app)/transactions/actions";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton, GlassPill } from "@/components/ios/glass";
import { ActionRow, ListRow } from "@/components/ios/list";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import { IosAlert } from "@/components/ios/alert";
import { canPop, popBack } from "@/components/ios/nav-stack";
import { useAddTransaction } from "@/components/transactions/add-transaction";
import {
  CategoryPickerSheet,
  type PickerCategory,
} from "@/components/transactions/ios/category-picker-sheet";

const SOURCE_ICON: Record<TransactionDetail["source"], SymbolName> = {
  apple_pay: "contactless",
  manual: "edit",
  import: "upload_file",
  recurring: "repeat",
};

export function TransactionDetailView({
  detail,
  history,
  categories,
}: {
  readonly detail: TransactionDetail;
  readonly history: MerchantHistory | null;
  readonly categories: readonly PickerCategory[];
}) {
  const t = useTranslations("ios.detail");
  const tx = useTranslations("ios.tx");
  const f = useFormats();
  const router = useRouter();
  const compose = useAddTransaction();
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState(false);

  const leave = () => {
    if (canPop()) popBack(router);
    else router.replace("/transactions", { transitionTypes: ["ios-pop"] });
  };
  const failed = ({ error }: { error: { serverError?: string | undefined } }) => {
    toast.error(error.serverError ?? tx("failed"));
  };
  const remove = useAction(deleteTransaction, {
    onSuccess: () => {
      toast.success(tx("deleted"));
      setConfirm(false);
      leave();
    },
    onError: failed,
  });
  const recategorize = useAction(changeTransactionCategory, {
    onSuccess: () => {
      toast.success(tx("categoryChanged"));
      router.refresh();
    },
    onError: failed,
  });
  const repeat = useAction(makeTransactionRecurring, {
    onSuccess: () => {
      toast.success(t("repeatSet"));
      router.refresh();
    },
    onError: failed,
  });

  const title =
    detail.merchant ?? detail.categoryName ?? (detail.isTransfer ? tx("title") : t("title"));
  const color = detail.categoryColor ?? "var(--ios-gray)";
  const icon = detail.isTransfer ? "swap_horiz" : categorySymbol(detail.categoryIcon, detail.categorySlug);
  const amount = minus(f.money(detail.amountMinor, detail.currency, { signed: true }));
  const when = [
    format(new Date(`${detail.occurredOn}T12:00:00`), "EEEEEE, d MMM", { locale: f.calendar }),
    detail.occurredAt === null
      ? null
      : new Intl.DateTimeFormat(f.calendar.code, { hour: "2-digit", minute: "2-digit" }).format(
          new Date(detail.occurredAt),
        ),
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const kind = detail.amountMinor > 0 ? "income" : "expense";
  const repeatLabel =
    detail.recurringRule === null
      ? t("never")
      : detail.recurringRule.active
        ? t(`every.${detail.recurringRule.frequency}`)
        : t("paused");

  const share = async () => {
    const text = `${title} · ${amount} · ${f.date(detail.occurredOn)}`;
    try {
      if (typeof navigator.share === "function") await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success(tx("copied"));
      }
    } catch {
      // The share sheet was dismissed.
    }
  };

  const max = Math.max(1, ...(history?.months.map((m) => m.totalMinor) ?? [1]));

  return (
    <>
      <NavBar
        title={title}
        titleOnScroll
        back={{ href: "/transactions" }}
        trailing={
          <div className="flex items-center gap-2.5">
            <GlassButton icon="ios_share" label={tx("share")} onClick={() => { void share(); }} />
            {!detail.isTransfer && (
              <GlassPill
                onClick={() => {
                  compose.edit(detail.id);
                }}
              >
                {tx("edit")}
              </GlassPill>
            )}
          </div>
        }
      />

      <ScreenBody className="gap-5 pt-1">
        <header className="flex flex-col items-center gap-1.5 pt-1 pb-1.5 text-center">
          <span
            className="grid size-[76px] place-items-center rounded-[22px] text-white"
            style={{ backgroundColor: color, boxShadow: `0 8px 20px color-mix(in srgb, ${color} 30%, transparent)` }}
          >
            <Symbol name={icon} size={40} weight={600} />
          </span>
          <h1 className="t-title2 mt-1">{title}</h1>
          <p className="money text-[48px] leading-[56px] font-bold tracking-[-0.03em]">{amount}</p>
          <p className="bg-ios-fill-3 flex h-[30px] items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[14px] font-medium tracking-[-0.006em]">
            <Symbol name={SOURCE_ICON[detail.source]} size={18} />
            {t("sourceLine", { source: t(`source.${detail.source}`), when })}
          </p>
        </header>

        {detail.isTransfer ? (
          <div className="inset-group">
            <ListRow
              title={t("from")}
              value={detail.amountMinor < 0 ? detail.accountName : (detail.transferPeerAccountName ?? "")}
              tile={{ icon: "account_balance", color: "var(--ios-blue)" }}
              accessory="none"
            />
            <ListRow
              title={t("to")}
              value={detail.amountMinor < 0 ? (detail.transferPeerAccountName ?? "") : detail.accountName}
              tile={{ icon: "swap_horiz", color: "var(--ios-teal)" }}
              accessory="none"
            />
          </div>
        ) : (
          <div className="inset-group">
            <ListRow
              title={t("category")}
              value={detail.categoryName ?? tx("category")}
              tile={{ icon, color }}
              onClick={() => {
                setPicking(true);
              }}
            />
            <ListRow
              title={t("account")}
              value={detail.accountName}
              tile={{ icon: "account_balance", color: "var(--ios-blue)" }}
              accessory="none"
            />
            <ListRow
              title={t("paidBy")}
              value={
                detail.splitPeer === null
                  ? (detail.paidByName ?? "")
                  : t("splitWith", { name: detail.paidByName ?? "", other: detail.splitPeer.paidByName ?? "" })
              }
              tile={{ icon: detail.splitPeer === null ? "person" : "group", color: detail.paidByColor ?? "var(--ios-tint)" }}
              accessory="none"
            />
            {detail.recurringRule === null ? (
              <GlassMenu
                label={t("repeat")}
                trigger={
                  <button type="button" className="w-full">
                    <ListRow
                      title={t("repeat")}
                      value={repeatLabel}
                      tile={{ icon: "repeat", color: "var(--ios-gray)" }}
                    />
                  </button>
                }
                entries={(["weekly", "monthly", "yearly"] as const).map((frequency) => ({
                  key: frequency,
                  label: t(`every.${frequency}`),
                  onSelect: () => {
                    repeat.execute({ id: detail.id, frequency });
                  },
                }))}
              />
            ) : (
              <ListRow
                title={t("repeat")}
                value={repeatLabel}
                tile={{ icon: "repeat", color: "var(--ios-purple)" }}
                href="/recurring"
              />
            )}
          </div>
        )}

        {detail.note !== null && (
          <div className="inset-group flex flex-col gap-1 px-4 py-3.5">
            <span className="t-footnote text-label-2">{t("note")}</span>
            <p className="t-body">{detail.note}</p>
          </div>
        )}

        {history !== null && history.count > 0 && detail.merchant !== null && (
          <Link
            href={`/transactions?search=1&q=${encodeURIComponent(detail.merchant)}`}
            transitionTypes={["ios-push"]}
            className="inset-group press flex flex-col gap-3 p-4"
          >
            <span className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="t-headline truncate">
                  {t("historyTitle", { merchant: detail.merchant, months: history.months.length })}
                </span>
                <span className="text-label-2 text-[14px] tracking-[-0.006em]">
                  {t("historySub", {
                    count: history.count,
                    average: f.money(history.averageMinor, detail.currency),
                  })}
                </span>
              </span>
              <Symbol name="chevron_right" size={20} weight={600} className="text-label-3" />
            </span>
            <span className="flex h-[84px] items-end gap-2.5">
              {history.months.map((month, index) => {
                const current = index === history.months.length - 1;
                return (
                  <span key={month.monthStart} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className="w-full rounded-md"
                      style={{
                        height: Math.max(4, Math.round((month.totalMinor / max) * 66)),
                        backgroundColor: current ? color : "var(--ios-fill)",
                      }}
                    />
                    <span className="text-label-2 text-[11px] leading-[13px]">
                      {format(new Date(`${month.monthStart}T12:00:00`), "LLL", { locale: f.calendar }).replace(".", "")}
                    </span>
                  </span>
                );
              })}
            </span>
          </Link>
        )}

        <ActionRow
          destructive
          onClick={() => {
            setConfirm(true);
          }}
        >
          {t("delete")}
        </ActionRow>
      </ScreenBody>

      <IosAlert
        open={confirm}
        onOpenChange={setConfirm}
        title={tx("deleteTitle")}
        message={tx("deleteMessage", {
          what: title,
          amount,
          date: f.date(detail.occurredOn),
          account: detail.accountName,
        })}
        cancelLabel={tx("cancel")}
        confirmLabel={tx("delete")}
        pending={remove.isPending}
        onConfirm={() => {
          remove.execute({ id: detail.id });
        }}
      />

      <CategoryPickerSheet
        open={picking}
        onOpenChange={setPicking}
        categories={categories}
        kind={kind}
        selectedId={detail.categoryId}
        onPick={(categoryId) => {
          recategorize.execute({ id: detail.id, categoryId });
        }}
      />
    </>
  );
}
