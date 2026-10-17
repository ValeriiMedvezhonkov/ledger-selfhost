"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Minor } from "@/lib/money";
import type { ISODate } from "@/lib/date";
import type { TransactionListItem } from "@/lib/queries";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import { NavBar } from "@/components/ios/nav-bar";
import { GlassButton } from "@/components/ios/glass";
import { Symbol } from "@/components/ios/symbol";
import { TransactionRow, useWhen } from "@/components/ios/transaction-row";
import { canPop, popBack, previousScreen } from "@/components/ios/nav-stack";

const RECENT_KEY = "ledger-recent-searches";
const RECENT_MAX = 6;

/* Recent searches live in localStorage — per device, nothing to sync. */
const listeners = new Set<() => void>();
function readRecent(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function pushRecent(query: string): void {
  const list = (JSON.parse(readRecent()) as string[]).filter(
    (item) => item !== query,
  );
  list.unshift(query);
  try {
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(list.slice(0, RECENT_MAX)),
    );
  } catch {
    // Private mode: no history, no harm.
  }
  listeners.forEach((listener) => {
    listener();
  });
}
function clearRecent(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
  listeners.forEach((listener) => {
    listener();
  });
}
/** The in-app history only changes by navigating, which re-renders anyway. */
function noSubscription(): () => void {
  return () => undefined;
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Поиск (board L10). The field sits at the bottom, on glass, right above the
 * keyboard — where iOS 26 moved search — with a close button beside it.
 * Typing re-queries the server (merchant, note, category and amount
 * expressions like «> 50 €»); recent searches are offered as tokens.
 */
export function SearchMode({
  items,
  total,
  netMinor,
  today,
  query,
  baseCurrency,
  onQuery,
}: {
  readonly items: readonly TransactionListItem[];
  readonly total: number;
  readonly netMinor: Minor;
  readonly today: ISODate;
  readonly query: string;
  readonly baseCurrency: string;
  readonly onQuery: (q: string) => void;
}) {
  const t = useTranslations("ios.search");
  const f = useFormats();
  const router = useRouter();
  const when = useWhen(today);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);
  const recentRaw = useSyncExternalStore(subscribe, readRecent, () => "[]");
  const recent = JSON.parse(recentRaw) as string[];

  useEffect(() => {
    input.current?.focus();
  }, []);

  // In iOS 26 search the field takes the tab bar's place (app/ios.css hides
  // the bar while this attribute is on <html>).
  useEffect(() => {
    document.documentElement.toggleAttribute("data-searching", true);
    return () => {
      document.documentElement.toggleAttribute("data-searching", false);
    };
  }, []);

  useEffect(() => {
    if (value === query) return;
    const timer = window.setTimeout(() => {
      onQuery(value);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, query, onQuery]);

  /*
   * A search is remembered when it was meant: submitted with the keyboard's
   * Search key, or when one of its results is opened — not every prefix the
   * live query happened to match while typing («Sl», «Slo», «Slov»…).
   */
  const remember = () => {
    const term = value.trim();
    if (term !== "") pushRecent(term);
  };

  /*
   * Closing returns to wherever search was opened from — the list, Обзор, a
   * transaction — with the pop slide. Opened cold (a link from outside), it
   * slides back to the list instead.
   */
  const close = () => {
    if (canPop()) popBack(router);
    else router.replace("/transactions", { transitionTypes: ["ios-pop"] });
  };
  // Where the back chevron leads; known only in the browser (the in-app
  // history), so the server render assumes the list.
  const backHref = useSyncExternalStore(
    noSubscription,
    () => previousScreen() ?? "/transactions",
    () => "/transactions",
  );

  return (
    <>
      <NavBar title={t("title")} back={{ href: backHref }} />
      <div
        className="flex flex-col gap-[18px] px-4 pt-2"
        // Clears the search field floating at the bottom. With the keyboard
        // up, iOS lets the page scroll the rest into view by itself.
        style={{ paddingBottom: "calc(var(--safe-bottom) + 96px)" }}
      >
        {/* Recents are suggestions for an empty field, as in iOS search. */}
        {value.trim() === "" && recent.length > 0 && (
          <section className="flex flex-col gap-2">
            <header className="flex items-center">
              <h2 className="t-subhead text-label-2 min-w-0 flex-1 font-semibold">
                {t("recent")}
              </h2>
              <button
                type="button"
                onClick={clearRecent}
                className="t-subhead text-tint press font-medium"
              >
                {t("clearRecent")}
              </button>
            </header>
            <div className="flex flex-wrap gap-2">
              {recent.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => {
                    setValue(token);
                    onQuery(token);
                  }}
                  className="bg-ios-card press flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[15px] font-medium"
                >
                  <Symbol name="history" size={16} className="text-label-2" />
                  {token}
                </button>
              ))}
            </div>
          </section>
        )}

        {query.trim() !== "" && (
          <section className="flex flex-col gap-1.5">
            <header className="flex items-center gap-2 px-4">
              <h2 className="t-subhead text-label-2 min-w-0 flex-1 font-semibold">
                {t("results", { count: total })}
              </h2>
              <span className="t-subhead text-label-2 money">
                {minus(f.money(netMinor, baseCurrency))}
              </span>
            </header>
            {items.length === 0 ? (
              <p className="inset-group t-subhead text-label-2 p-6 text-center">
                {t("nothing")}
              </p>
            ) : (
              <div className="inset-group" onClickCapture={remember}>
                {items.map((row) => (
                  <TransactionRow
                    key={row.id}
                    row={row}
                    when={when(row)}
                    meta={[row.categoryName, f.dateShort(row.occurredOn)]
                      .filter((part): part is string => part !== null)
                      .join(" · ")}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div
        className="ios-fixed z-50 flex items-center gap-2.5 px-4"
        style={{
          bottom:
            "calc(max(12px, calc(var(--safe-bottom) - 6px)) - var(--vp-fix))",
        }}
      >
        <label className="glass glass-strong flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full pr-2.5 pl-3.5">
          <Symbol name="search" size={20} className="text-label-2" />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            value={value}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onQuery(value);
                remember();
                input.current?.blur();
              }
            }}
            className="t-body placeholder:text-label-2 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {value !== "" && (
            <button
              type="button"
              aria-label={t("clear")}
              onClick={() => {
                setValue("");
                input.current?.focus();
              }}
              className="bg-label-3 grid size-5 place-items-center rounded-full text-[var(--ios-card)]"
            >
              <Symbol name="close" size={14} weight={700} />
            </button>
          )}
        </label>
        <GlassButton icon="close" label={t("close")} onClick={close} />
      </div>
    </>
  );
}
