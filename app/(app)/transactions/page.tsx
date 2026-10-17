import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/now";
import { currentMonthRange, todayISO } from "@/lib/date";
import {
  listAccounts,
  listCategories,
  listMembers,
  listTransactions,
  sumTransactions,
} from "@/lib/queries";
import { transactionFilterSchema, type TransactionFilters } from "@/lib/validations";
import { Screen } from "@/components/ios/screen";
import { TransactionsScreen } from "@/components/transactions/ios/transactions-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.tx");
  return { title: t("title") };
}

/** How many pages «Показать ещё» may have accumulated into one render. */
const MAX_PAGES = 12;

/**
 * Операции (boards L03, L06, L07, L10). Filters live in the URL so a
 * filtered list survives refresh and back; with no period the list shows the
 * current month, as the tinted «Сентябрь» chip on the board does. `?all=1`
 * lifts the date bound; `?search=1` opens the search mode over the list.
 */
export default async function TransactionsPage(props: PageProps<"/transactions">) {
  const user = await requireUser();
  const raw = await props.searchParams;
  const now = serverNow();

  const parsed = transactionFilterSchema.safeParse(raw);
  const base: TransactionFilters = parsed.success ? parsed.data : transactionFilterSchema.parse({});
  const allTime = raw.all === "1";
  const searching = raw.search === "1";
  const month = currentMonthRange(now);
  const filters: TransactionFilters =
    base.from === undefined && base.to === undefined && !allTime && !searching
      ? { ...base, from: month.from, to: month.to }
      : base;

  const pages = Math.min(MAX_PAGES, filters.page);
  const [results, total, accounts, categories, members] = await Promise.all([
    Promise.all(
      Array.from({ length: pages }, (_, index) =>
        listTransactions(user.householdId, { ...filters, page: index + 1 }),
      ),
    ),
    sumTransactions(user.householdId, filters),
    listAccounts(user.householdId),
    listCategories(user.householdId),
    listMembers(user.householdId),
  ]);
  const last = results.at(-1);
  const items = results.flatMap((page) => page.items);

  return (
    <Screen>
      <TransactionsScreen
        items={items}
        total={last?.total ?? 0}
        hasMore={(last?.page ?? 1) < (last?.pageCount ?? 1)}
        netMinor={total.netMinor}
        today={todayISO(now)}
        filters={{
          from: filters.from ?? null,
          to: filters.to ?? null,
          allTime,
          categoryIds: [
            ...filters.categoryIds,
            ...(filters.categoryId === undefined ? [] : [filters.categoryId]),
          ],
          paidByUserId: filters.paidByUserId ?? null,
          accountId: filters.accountId ?? null,
          q: filters.q ?? "",
          page: pages,
        }}
        searching={searching}
        baseCurrency={user.baseCurrency}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          color: c.color,
          kind: c.kind,
        }))}
        members={members.map((m) => ({ id: m.id, name: m.name, color: m.color }))}
      />
    </Screen>
  );
}
