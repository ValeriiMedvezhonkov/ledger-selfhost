import type { ISODate } from "@/lib/date";
import type { BudgetWithSpend } from "@/lib/queries";
import type { NetWorthPoint } from "@/lib/stats";
import type { StatsChartPrefs } from "@/lib/stats-charts";
import type { StatsFilters } from "@/lib/stats-filters";
import type { StatsInsights } from "@/lib/stats-insights";

export interface StatsCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly icon: string;
  readonly color: string;
  readonly kind: "income" | "expense";
}

export interface StatsMember {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Everything the server works out for Статистика, ready to draw. */
export interface StatsData {
  readonly today: ISODate;
  readonly currency: string;
  readonly filters: StatsFilters;
  readonly insights: StatsInsights;
  readonly categories: readonly StatsCategory[];
  readonly members: readonly StatsMember[];
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly budgets: readonly BudgetWithSpend[];
  readonly netWorth: readonly NetWorthPoint[];
  readonly charts: StatsChartPrefs;
  readonly labels: {
    /** «Октябрь 2026», «29 сент. – 5 окт.», «2026». */
    readonly period: string;
    /** The period chip: «Октябрь». */
    readonly chip: string;
    /** Small «1 октября»: when the period started, for «Потрачено с …». */
    readonly since: string;
    /** Legend: «октябрь» / «сентябрь» or «среднее за 6 мес.». */
    readonly current: string;
    readonly compare: string;
    /**
     * Picks the comparison's wording in the catalogue: a month number
     * («к сентябрю» needs the dative, which Intl does not make), `week`,
     * `year`, or `avg`.
     */
    readonly compareRef: string;
    /** Short month names for the six-month charts. */
    readonly months: readonly string[];
    /** The «Когда» calendar's weekday initials, Monday first. */
    readonly weekdays: readonly string[];
    /** Year view: short month names for the twelve cells. */
    readonly yearMonths: readonly string[];
  };
  /** The period chip's menu: recent periods of the same span. */
  readonly periods: readonly { readonly at: ISODate; readonly label: string }[];
}
