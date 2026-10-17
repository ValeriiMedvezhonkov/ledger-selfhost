import { describe, expect, it } from "vitest";
import { projectGoal } from "@/lib/goals";
import { toMinor } from "@/lib/money";

// Noon, so no timezone the tests run in can move the calendar date.
const NOW = new Date(2026, 9, 2, 12, 0, 0);

describe("projectGoal", () => {
  it("reports progress and what is left", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(100_000),
        savedMinor: toMinor(25_000),
        firstContributionOn: "2026-09-02",
        lastContributionOn: "2026-09-02",
      },
      NOW,
    );
    expect(result.percent).toBe(25);
    expect(result.remainingMinor).toBe(75_000);
    expect(result.achievedOn).toBeNull();
  });

  it("extrapolates the average pace since the first contribution", () => {
    // 250 € over 30 days → 750 € left takes 90 more days.
    const result = projectGoal(
      {
        targetMinor: toMinor(100_000),
        savedMinor: toMinor(25_000),
        firstContributionOn: "2026-09-02",
        lastContributionOn: "2026-09-20",
      },
      NOW,
    );
    expect(result.projectedOn).toBe("2026-12-31");
  });

  it("treats money saved today as one day of pace", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(1_000),
        savedMinor: toMinor(100),
        firstContributionOn: "2026-10-02",
        lastContributionOn: "2026-10-02",
      },
      NOW,
    );
    expect(result.projectedOn).toBe("2026-10-11");
  });

  it("has no projection without savings", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(1_000),
        savedMinor: toMinor(0),
        firstContributionOn: null,
        lastContributionOn: null,
      },
      NOW,
    );
    expect(result.percent).toBe(0);
    expect(result.projectedOn).toBeNull();
  });

  it("finds the day the running total first crossed the target", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(1_000),
        savedMinor: toMinor(1_200),
        firstContributionOn: "2026-06-01",
        lastContributionOn: "2026-09-01",
        contributions: [
          // Deliberately out of order.
          { occurredOn: "2026-09-01", amountMinor: toMinor(200) },
          { occurredOn: "2026-06-01", amountMinor: toMinor(600) },
          { occurredOn: "2026-07-15", amountMinor: toMinor(400) },
        ],
      },
      NOW,
    );
    expect(result.achievedOn).toBe("2026-07-15");
    expect(result.percent).toBe(100);
    expect(result.remainingMinor).toBe(0);
    expect(result.projectedOn).toBeNull();
  });

  it("uses the first crossing even after a later withdrawal", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(1_000),
        savedMinor: toMinor(1_000),
        firstContributionOn: "2026-06-01",
        lastContributionOn: "2026-08-01",
        contributions: [
          { occurredOn: "2026-06-01", amountMinor: toMinor(1_100) },
          { occurredOn: "2026-07-01", amountMinor: toMinor(-300) },
          { occurredOn: "2026-08-01", amountMinor: toMinor(200) },
        ],
      },
      NOW,
    );
    expect(result.achievedOn).toBe("2026-06-01");
  });

  it("falls back to the last contribution without per-contribution data", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(1_000),
        savedMinor: toMinor(1_000),
        firstContributionOn: "2026-06-01",
        lastContributionOn: "2026-08-01",
      },
      NOW,
    );
    expect(result.achievedOn).toBe("2026-08-01");
  });

  it("gives up on a projection more than a century out", () => {
    const result = projectGoal(
      {
        targetMinor: toMinor(100_000_000),
        savedMinor: toMinor(1),
        firstContributionOn: "2016-10-02",
        lastContributionOn: "2016-10-02",
      },
      NOW,
    );
    expect(result.projectedOn).toBeNull();
  });
});
