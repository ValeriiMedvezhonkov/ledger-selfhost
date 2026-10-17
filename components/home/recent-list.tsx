"use client";

import type { ISODate } from "@/lib/date";
import { TransactionRow, useWhen, type TxRowData } from "@/components/ios/transaction-row";

/** «Последние»: the latest entries as one inset card of rows. */
export function RecentList({
  rows,
  today,
  emptyLabel,
}: {
  readonly rows: readonly TxRowData[];
  readonly today: ISODate;
  readonly emptyLabel: string;
}) {
  const when = useWhen(today);
  if (rows.length === 0) {
    return <p className="inset-group t-subhead text-label-2 p-5 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="inset-group">
      {rows.map((row) => (
        <TransactionRow key={row.id} row={row} when={when(row)} />
      ))}
    </div>
  );
}
