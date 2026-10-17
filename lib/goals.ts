import { addDaysISO, compareISO, daysBetweenISO, todayISO, type ISODate } from "@/lib/date";
import { ZERO, toMinor, type Minor } from "@/lib/money";

/**
 * Where a savings goal stands and, at the current pace, when it gets there.
 *
 * Pure: the clock comes in as `now`, so the goals screen renders the same
 * thing on the server and in a test.
 */

export interface GoalContributionPoint {
  readonly occurredOn: ISODate;
  readonly amountMinor: Minor;
}

export interface GoalProgressInput {
  readonly targetMinor: Minor;
  readonly savedMinor: Minor;
  readonly firstContributionOn: ISODate | null;
  readonly lastContributionOn: ISODate | null;
  /**
   * Every contribution (or per-day totals), any order. Needed to say *when* a
   * goal was reached — the running total can cross the target and then fall
   * back below it after a withdrawal, which `savedMinor` alone cannot show.
   */
  readonly contributions?: readonly GoalContributionPoint[];
}

export interface GoalProjection {
  /** 0–100, clamped. A goal saved past its target reads as full, not 130 %. */
  readonly percent: number;
  /** Never negative — an over-funded goal has nothing remaining. */
  readonly remainingMinor: Minor;
  /** The day the running total first reached the target, if it has. */
  readonly achievedOn: ISODate | null;
  /**
   * The day the target is reached if saving continues at the average pace
   * since the first contribution. Null when the goal is already reached, or
   * there is no pace to extrapolate — nothing saved yet, or a net withdrawal.
   */
  readonly projectedOn: ISODate | null;
}

/** Beyond this a projection is noise, not a date anyone should plan around. */
const MAX_PROJECTION_DAYS = 365 * 100;

function firstReached(
  target: Minor,
  contributions: readonly GoalContributionPoint[],
): ISODate | null {
  const ordered = [...contributions].sort((a, b) =>
    compareISO(a.occurredOn, b.occurredOn),
  );
  let running = 0;
  for (const point of ordered) {
    running += point.amountMinor;
    if (running >= target) return point.occurredOn;
  }
  return null;
}

export function projectGoal(input: GoalProgressInput, now: Date): GoalProjection {
  const { targetMinor, savedMinor } = input;

  const percent =
    targetMinor <= 0
      ? savedMinor > 0
        ? 100
        : 0
      : Math.min(100, Math.max(0, (savedMinor / targetMinor) * 100));

  const remainingMinor =
    savedMinor >= targetMinor ? ZERO : toMinor(targetMinor - savedMinor);

  const reached = targetMinor > 0 && savedMinor >= targetMinor;

  let achievedOn: ISODate | null = null;
  if (reached) {
    achievedOn =
      input.contributions === undefined
        ? input.lastContributionOn
        : (firstReached(targetMinor, input.contributions) ??
          input.lastContributionOn);
  }

  let projectedOn: ISODate | null = null;
  const first = input.firstContributionOn;
  if (!reached && first !== null && savedMinor > 0) {
    const today = todayISO(now);
    // At least one day, so money saved today gives a pace instead of a
    // division by zero — saving 100 today projects "100 a day", which is the
    // honest extrapolation of one data point.
    const elapsed = Math.max(1, daysBetweenISO(first, today));
    const perDay = savedMinor / elapsed;
    const daysLeft = Math.ceil(remainingMinor / perDay);
    if (Number.isFinite(daysLeft) && daysLeft <= MAX_PROJECTION_DAYS) {
      projectedOn = addDaysISO(today, daysLeft);
    }
  }

  return { percent, remainingMinor, achievedOn, projectedOn };
}
