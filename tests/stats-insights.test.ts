import { describe, expect, it } from "vitest";
import {
  defaultStatsFilters,
  parseStatsFilters,
  shiftStatsPeriod,
  statsPeriod,
  statsQuery,
} from "@/lib/stats-filters";
import { computeStatsInsights, statsWindow, type StatRow } from "@/lib/stats-insights";
import { parseStatsChartPrefs, serializeStatsChartPrefs } from "@/lib/stats-charts";
import type { Minor } from "@/lib/money";

const TODAY = "2026-10-18";

function row(on: string, amount: number, extra: Partial<StatRow> = {}): StatRow {
  return {
    on,
    at: null,
    type: "expense",
    amount,
    categoryId: "food",
    merchant: null,
    memberId: "a",
    fixed: false,
    ...extra,
  };
}

describe("stats filters", () => {
  it("leaves defaults out of the URL and reads back what it writes", () => {
    const filters = defaultStatsFilters(TODAY);
    expect(statsQuery(filters, TODAY)).toBe("");

    const narrowed = {
      ...filters,
      span: "week" as const,
      at: "2026-09-02",
      categoryIds: ["food", "fuel"],
      memberId: "a",
      kind: "income" as const,
      withoutFixed: true,
      compare: "average" as const,
    };
    const query = statsQuery(narrowed, TODAY);
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseStatsFilters(params, TODAY)).toEqual(narrowed);
  });

  it("falls back on nonsense and refuses a period that has not started", () => {
    const parsed = parseStatsFilters(
      { span: "decade", at: "2027-01-01", kind: "both", cat: "a,<script>,b" },
      TODAY,
    );
    expect(parsed.span).toBe("month");
    expect(parsed.at).toBe(TODAY);
    expect(parsed.kind).toBe("expense");
    expect(parsed.categoryIds).toEqual(["a", "b"]);
  });

  it("starts weeks on Monday and steps months across a year end", () => {
    expect(statsPeriod("week", "2026-10-18")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(shiftStatsPeriod("month", "2026-01-31", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("chart prefs", () => {
  it("keeps the owner's order and adds charts it has not seen, at their defaults", () => {
    const prefs = parseStatsChartPrefs("when,-pace,bogus,when");
    expect(prefs.order.slice(0, 3)).toEqual(["when", "pace", "categories"]);
    expect(prefs.hidden).toEqual(["pace", "networth"]);
    expect(parseStatsChartPrefs(serializeStatsChartPrefs(prefs))).toEqual(prefs);
  });
});

describe("stats insights", () => {
  const filters = defaultStatsFilters(TODAY);
  const rows: StatRow[] = [
    // September: rent on the 1st, 10 € a day of food.
    row("2026-09-01", 75_000, { categoryId: "housing", fixed: true, merchant: "Nájom" }),
    ...Array.from({ length: 30 }, (_, i) =>
      row(`2026-09-${String(i + 1).padStart(2, "0")}`, 1_000, { merchant: i % 2 === 0 ? "Lidl" : "LIDL " }),
    ),
    row("2026-09-15", 300_000, { type: "income", categoryId: "salary" }),
    // October so far: rent, and 8 € a day of food for 18 days.
    row("2026-10-01", 75_000, { categoryId: "housing", fixed: true, merchant: "Nájom" }),
    ...Array.from({ length: 18 }, (_, i) =>
      row(`2026-10-${String(i + 1).padStart(2, "0")}`, 800, { memberId: i < 9 ? "a" : "b" }),
    ),
    // A future-dated row does not count yet.
    row("2026-10-25", 99_999),
  ];
  const insights = computeStatsInsights({
    rows,
    filters,
    today: TODAY,
    budgets: [{ categoryId: "food", limitMinor: 30_000 as Minor, isFixed: false }],
    firstDataOn: "2026-09-01",
  });

  it("measures the month so far against the same days of the last one", () => {
    expect(insights.inProgress).toBe(true);
    expect(insights.elapsedDays).toBe(18);
    expect(insights.summary.totalMinor).toBe(75_000 + 18 * 800);
    expect(insights.summary.compareMinor).toBe(75_000 + 18 * 1_000);
    expect(insights.summary.change).toBeCloseTo((75_000 + 14_400) / (75_000 + 18_000) - 1);
    expect(insights.summary.current).toHaveLength(18);
    expect(insights.summary.compare).toHaveLength(31);
    // September has 30 days: the 31st holds its total.
    expect(insights.summary.compare[30]).toBe(insights.summary.compare[29]);
  });

  it("runs only the flexible part forward to the month's end", () => {
    expect(insights.summary.projectionMinor).toBe(Math.round(75_000 + (14_400 * 31) / 18));
    expect(insights.summary.budgetMinor).toBe(30_000);
  });

  it("compares each category by the same day and marks recurring ones", () => {
    const housing = insights.categories.find((c) => c.categoryId === "housing");
    const food = insights.categories.find((c) => c.categoryId === "food");
    expect(housing).toMatchObject({ totalMinor: 75_000, compareMinor: 75_000, allFixed: true, count: 1 });
    expect(food).toMatchObject({ totalMinor: 14_400, compareMinor: 18_000, allFixed: false, count: 18 });
  });

  it("groups merchants however they were typed", () => {
    const window = computeStatsInsights({
      rows,
      filters: { ...filters, at: "2026-09-10" },
      today: TODAY,
      budgets: [],
      firstDataOn: "2026-09-01",
    });
    const lidl = window.merchants.find((m) => m.name.toLowerCase() === "lidl");
    expect(lidl?.count).toBe(30);
    expect(window.inProgress).toBe(false);
    expect(window.summary.projectionMinor).toBeNull();
  });

  it("does not average in months before the household started", () => {
    const average = computeStatsInsights({
      rows,
      filters: { ...filters, compare: "average" },
      today: TODAY,
      budgets: [],
      firstDataOn: "2026-09-01",
    });
    expect(average.compareRanges).toHaveLength(1);
    expect(average.summary.compareMinor).toBe(75_000 + 18 * 1_000);
  });

  it("leaves recurring payments out when asked", () => {
    const flexible = computeStatsInsights({
      rows,
      filters: { ...filters, withoutFixed: true },
      today: TODAY,
      budgets: [],
      firstDataOn: "2026-09-01",
    });
    expect(flexible.summary.totalMinor).toBe(14_400);
    expect(flexible.categories.map((c) => c.categoryId)).toEqual(["food"]);
  });

  it("splits fixed from flexible and averages finished months only", () => {
    const { months, fixedAverageMinor, flexibleAverageMinor } = insights.fixedFlexible;
    expect(months).toHaveLength(6);
    expect(months.at(-1)).toMatchObject({ fixedMinor: 75_000, flexibleMinor: 14_400 });
    expect(months.at(-1)?.projectedMinor).toBe(Math.round((14_400 * 31) / 18 - 14_400));
    expect(fixedAverageMinor).toBe(75_000);
    expect(flexibleAverageMinor).toBe(30_000);
  });

  it("works out the savings rate from finished months", () => {
    expect(insights.savings.rate).toBeCloseTo((300_000 - 105_000) / 300_000);
  });

  it("splits who spent, with and without recurring payments", () => {
    expect(insights.members.totals).toEqual([
      { memberId: "a", totalMinor: 75_000 + 9 * 800 },
      { memberId: "b", totalMinor: 9 * 800 },
    ]);
  });

  it("loads far enough back for the comparison and the six months", () => {
    expect(statsWindow(filters, TODAY)).toEqual({ from: "2026-05-01", to: "2026-10-31" });
    expect(statsWindow({ ...filters, compare: "average" }, TODAY).from).toBe("2026-04-01");
  });
});
