"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export interface TxFilterState {
  readonly from: string | null;
  readonly to: string | null;
  readonly allTime: boolean;
  readonly categoryIds: readonly string[];
  readonly paidByUserId: string | null;
  readonly accountId: string | null;
  readonly q: string;
  readonly page: number;
}

export type TxFilterPatch = Partial<Omit<TxFilterState, "page">>;

/** Serialise a filter state to the query string the page parses. */
export function filterQuery(state: TxFilterState, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (state.allTime) q.set("all", "1");
  else {
    if (state.from !== null) q.set("from", state.from);
    if (state.to !== null) q.set("to", state.to);
  }
  if (state.categoryIds.length > 0) q.set("categoryIds", state.categoryIds.join(","));
  if (state.paidByUserId !== null) q.set("paidByUserId", state.paidByUserId);
  if (state.accountId !== null) q.set("accountId", state.accountId);
  if (state.q.trim() !== "") q.set("q", state.q.trim());
  if (state.page > 1) q.set("page", String(state.page));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/**
 * Writes filter changes to the URL in one `replace` — two sequential writes
 * would each read the same stale params and the second would drop the first
 * (NOTES.md, range picker). Any change resets paging.
 */
export function useFilterNav(state: TxFilterState) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (patch: TxFilterPatch & { readonly page?: number }, keep: readonly string[] = ["search"]) => {
      const next: TxFilterState = { ...state, page: 1, ...patch };
      const extra: Record<string, string> = {};
      for (const key of keep) {
        const value = params.get(key);
        if (value !== null) extra[key] = value;
      }
      const query = filterQuery(next, extra);
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [state, params, pathname, router],
  );
}
