"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Minor } from "@/lib/money";
import type { ISODate } from "@/lib/date";
import { categorySymbol } from "@/lib/symbols";
import { useFormats } from "@/hooks/use-formats";
import { SymbolTile } from "@/components/ios/list";
import { cn } from "@/lib/utils";
import { minus } from "@/lib/typography";

/** What a row needs — a subset of TransactionListItem, so lists can share it. */
export interface TxRowData {
  readonly id: string;
  readonly type: "income" | "expense" | "transfer";
  readonly merchant: string | null;
  readonly note: string | null;
  readonly amountMinor: Minor;
  readonly currency: string;
  readonly occurredOn: ISODate;
  readonly occurredAt: Date | null;
  readonly accountName: string;
  readonly categoryName: string | null;
  readonly categorySlug: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly paidByColor: string | null;
}

/**
 * The trailing meta under an amount: the clock time when the app knows it
 * (an Apple Pay tap, an entry made the same day), otherwise the day relative
 * to `today` — «сегодня», «вчера» — or a short date further back.
 */
export function useWhen(today: ISODate) {
  const t = useTranslations("ios");
  const f = useFormats();
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  return (row: Pick<TxRowData, "occurredOn" | "occurredAt">): string => {
    if (row.occurredAt !== null) {
      return new Intl.DateTimeFormat(f.calendar.code, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(row.occurredAt));
    }
    if (row.occurredOn === today) return t("today");
    if (row.occurredOn === yesterday) return t("yesterday");
    return f.dateShort(row.occurredOn);
  };
}

/**
 * One transaction: a 40pt rounded logo tile in the category colour, the
 * merchant over «category · account», and the amount over a dot in the
 * payer's colour with the time. Pushes the detail screen.
 */
export function TransactionRow({
  row,
  when,
  meta,
  className,
}: {
  readonly row: TxRowData;
  /** Trailing meta (time / «вчера»). */
  readonly when: string;
  /** Override the second line (search results show the date there). */
  readonly meta?: string;
  readonly className?: string;
}) {
  const t = useTranslations("ios");
  const f = useFormats();
  const title =
    row.merchant ?? row.note ?? row.categoryName ?? (row.type === "transfer" ? t("transfer") : t("noCategory"));
  const second =
    meta ?? [row.categoryName ?? (row.type === "transfer" ? t("transfer") : null), row.accountName]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");
  const income = row.amountMinor > 0 && row.type !== "transfer";
  const color = row.categoryColor ?? "var(--ios-gray)";
  const icon = row.type === "transfer" ? "swap_horiz" : categorySymbol(row.categoryIcon, row.categorySlug);

  return (
    <Link
      href={`/transactions/${row.id}`}
      transitionTypes={["ios-push"]}
      className={cn("press-row flex min-h-16 w-full items-center gap-3 pl-4", className)}
    >
      <SymbolTile icon={icon} color={color} size={40} />
      <span className="row-sep flex min-h-16 min-w-0 flex-1 items-center gap-2 self-stretch py-2.5 pr-4">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="t-headline truncate">{title}</span>
          <span className="text-label-2 truncate text-[14px] leading-[18px] tracking-[-0.006em]">
            {second}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-[3px]">
          <span
            className={cn(
              "money t-body font-medium whitespace-nowrap",
              income && "text-ios-green",
            )}
          >
            {minus(f.money(row.amountMinor, row.currency, { signed: true }))}
          </span>
          <span className="t-footnote text-label-2 flex items-center gap-1">
            {row.paidByColor !== null && (
              <span
                aria-hidden
                className="size-[7px] rounded-full"
                style={{ backgroundColor: row.paidByColor }}
              />
            )}
            {when}
          </span>
        </span>
      </span>
    </Link>
  );
}
