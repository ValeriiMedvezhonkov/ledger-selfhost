import { describe, expect, it } from "vitest";
import {
  advanceByFrequency,
  bucketKey,
  compareISO,
  currentMonthRange,
  daysBetweenISO,
  daysElapsedInMonth,
  daysRemainingInMonth,
  enumerateBuckets,
  isISODate,
  lastNMonths,
  monthEndISO,
  monthStartISO,
  previousMonthRange,
  todayISO,
} from "@/lib/date";

describe("isISODate", () => {
  it("accepts real calendar dates only", () => {
    expect(isISODate("2026-08-19")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("19-08-2026")).toBe(false);
    expect(isISODate("2026-8-9")).toBe(false);
  });
});

describe("advanceByFrequency", () => {
  it("steps by each unit", () => {
    expect(advanceByFrequency("2026-01-15", "daily", 1)).toBe("2026-01-16");
    expect(advanceByFrequency("2026-01-15", "weekly", 1)).toBe("2026-01-22");
    expect(advanceByFrequency("2026-01-15", "monthly", 1)).toBe("2026-02-15");
    expect(advanceByFrequency("2026-01-15", "yearly", 1)).toBe("2027-01-15");
  });

  it("honours the interval", () => {
    expect(advanceByFrequency("2026-01-15", "monthly", 3)).toBe("2026-04-15");
    expect(advanceByFrequency("2026-01-01", "weekly", 2)).toBe("2026-01-15");
  });

  it("clamps a month-end date into a shorter month", () => {
    // 31 Jan + 1 month has no 31 Feb; it must land on the last valid day.
    expect(advanceByFrequency("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(advanceByFrequency("2026-03-31", "monthly", 1)).toBe("2026-04-30");
  });

  it("handles a leap day", () => {
    expect(advanceByFrequency("2028-02-29", "yearly", 1)).toBe("2029-02-28");
  });

  it("treats a non-positive interval as one step, never as no progress", () => {
    // A zero step would make the materialisation loop spin forever.
    expect(advanceByFrequency("2026-01-15", "daily", 0)).toBe("2026-01-16");
    expect(advanceByFrequency("2026-01-15", "daily", -3)).toBe("2026-01-16");
  });
});

describe("month helpers", () => {
  it("finds month boundaries", () => {
    expect(monthStartISO("2026-08-19")).toBe("2026-08-01");
    expect(monthEndISO("2026-08-19")).toBe("2026-08-31");
    expect(monthEndISO("2026-02-10")).toBe("2026-02-28");
  });

  it("counts elapsed and remaining days inclusively", () => {
    expect(daysElapsedInMonth("2026-08-01")).toBe(1);
    expect(daysElapsedInMonth("2026-08-19")).toBe(19);
    expect(daysRemainingInMonth("2026-08-31")).toBe(1);
    expect(daysElapsedInMonth("2026-08-19") + daysRemainingInMonth("2026-08-19") - 1).toBe(31);
  });
});

describe("ranges", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("builds the current month", () => {
    expect(currentMonthRange(now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("builds the previous month", () => {
    expect(previousMonthRange(now)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("builds an N-month window inclusive of the current month", () => {
    expect(lastNMonths(now, 3)).toEqual({ from: "2026-06-01", to: "2026-08-31" });
    expect(lastNMonths(now, 1)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("bucketing", () => {
  it("buckets to day, ISO week start and month", () => {
    expect(bucketKey("2026-08-19", "day")).toBe("2026-08-19");
    // 19 Aug 2026 is a Wednesday; the ISO week starts Monday the 17th.
    expect(bucketKey("2026-08-19", "week")).toBe("2026-08-17");
    expect(bucketKey("2026-08-19", "month")).toBe("2026-08-01");
  });

  it("enumerates every bucket so gaps render as zero", () => {
    const months = enumerateBuckets(
      { from: "2026-06-01", to: "2026-08-31" },
      "month",
    );
    expect(months).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);

    const days = enumerateBuckets(
      { from: "2026-08-01", to: "2026-08-05" },
      "day",
    );
    expect(days).toHaveLength(5);
  });

  it("returns a single bucket when the range is one day", () => {
    expect(
      enumerateBuckets({ from: "2026-08-19", to: "2026-08-19" }, "day"),
    ).toEqual(["2026-08-19"]);
  });
});

describe("comparison", () => {
  it("orders dates lexicographically, which ISO format guarantees", () => {
    expect(compareISO("2026-01-01", "2026-02-01")).toBe(-1);
    expect(compareISO("2026-02-01", "2026-01-01")).toBe(1);
    expect(compareISO("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("counts calendar days between dates", () => {
    expect(daysBetweenISO("2026-08-01", "2026-08-19")).toBe(18);
    expect(daysBetweenISO("2026-08-19", "2026-08-01")).toBe(-18);
  });
});

describe("todayISO", () => {
  it("formats the supplied clock rather than reading its own", () => {
    expect(todayISO(new Date(2026, 7, 19, 23, 30))).toBe("2026-08-19");
  });
});
