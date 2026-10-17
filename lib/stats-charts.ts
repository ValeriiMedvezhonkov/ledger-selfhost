/**
 * The charts on Статистика and the owner's arrangement of them (board L20
 * «Графики»): which are shown and in what order. Kept in a cookie rather than
 * localStorage so the server renders the screen already arranged — no flash
 * of the default order on the way in.
 */

export const STATS_CHARTS = [
  "pace",
  "categories",
  "merchants",
  "when",
  "fixed",
  "members",
  "savings",
  "budgets",
  "networth",
] as const;
export type StatsChart = (typeof STATS_CHARTS)[number];

export const STATS_CHARTS_COOKIE = "stats-charts";

/** Off until switched on: the board leaves «Чистые активы» off. */
const HIDDEN_BY_DEFAULT: readonly StatsChart[] = ["networth"];

export interface StatsChartPrefs {
  readonly order: readonly StatsChart[];
  readonly hidden: readonly StatsChart[];
}

function isChart(value: string): value is StatsChart {
  return (STATS_CHARTS as readonly string[]).includes(value);
}

/** `pace,categories,-networth`: the order, hidden ones marked with a minus. */
export function parseStatsChartPrefs(raw: string | undefined): StatsChartPrefs {
  const order: StatsChart[] = [];
  const hidden: StatsChart[] = [];
  for (const part of (raw ?? "").split(",")) {
    const off = part.startsWith("-");
    const id = off ? part.slice(1) : part;
    if (!isChart(id) || order.includes(id)) continue;
    order.push(id);
    if (off) hidden.push(id);
  }
  // Charts added after the cookie was written join at the end, as defaults.
  for (const id of STATS_CHARTS) {
    if (order.includes(id)) continue;
    order.push(id);
    if (HIDDEN_BY_DEFAULT.includes(id)) hidden.push(id);
  }
  return { order, hidden };
}

export function serializeStatsChartPrefs(prefs: StatsChartPrefs): string {
  return prefs.order.map((id) => (prefs.hidden.includes(id) ? `-${id}` : id)).join(",");
}
