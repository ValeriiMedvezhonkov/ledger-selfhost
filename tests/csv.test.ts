import { describe, expect, it } from "vitest";
import { mapRows, parseCsv, parseCsvDate, toCsv } from "@/lib/csv";
import { toMinor } from "@/lib/money";

const REFERENCE = new Date("2026-08-19T00:00:00Z");

describe("parseCsv", () => {
  it("reads headers and rows, trimming header whitespace", () => {
    const parsed = parseCsv("Date , Amount ,Note\n2026-08-01,-12.50,Lidl\n");
    expect(parsed.headers).toEqual(["Date", "Amount", "Note"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.Note).toBe("Lidl");
  });

  it("drops blank lines", () => {
    const parsed = parseCsv("Date,Amount\n2026-08-01,-1\n\n\n2026-08-02,-2\n");
    expect(parsed.rows).toHaveLength(2);
  });
});

describe("parseCsvDate", () => {
  it("always accepts ISO regardless of the selected format", () => {
    expect(parseCsvDate("2026-08-19", "dmy", REFERENCE)).toBe("2026-08-19");
  });

  it("disambiguates D/M/Y from M/D/Y by the chosen setting", () => {
    expect(parseCsvDate("08/09/2026", "dmy", REFERENCE)).toBe("2026-09-08");
    expect(parseCsvDate("08/09/2026", "mdy", REFERENCE)).toBe("2026-08-09");
  });

  it("accepts dotted European dates", () => {
    expect(parseCsvDate("19.08.2026", "dmy", REFERENCE)).toBe("2026-08-19");
    expect(parseCsvDate("1.9.2026", "dmy", REFERENCE)).toBe("2026-09-01");
  });

  it("returns null for unreadable input rather than guessing", () => {
    expect(parseCsvDate("not a date", "iso", REFERENCE)).toBeNull();
    expect(parseCsvDate("", "iso", REFERENCE)).toBeNull();
  });
});

const CONFIG = {
  dateColumn: "Date",
  amountColumn: "Amount",
  noteColumn: "Note",
  dateFormat: "iso" as const,
  currency: "EUR",
};

describe("mapRows", () => {
  it("maps valid rows and preserves the sign from the file", () => {
    const parsed = parseCsv(
      "Date,Amount,Note\n2026-08-01,-12.50,Lidl\n2026-08-02,2400.00,Salary\n",
    );
    const result = mapRows(parsed, CONFIG, [], REFERENCE);

    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]?.amountMinor).toBe(-1250);
    expect(result.valid[1]?.amountMinor).toBe(240000);
    expect(result.valid[0]?.note).toBe("Lidl");
  });

  it("reports bad rows with their line number and keeps the good ones", () => {
    const parsed = parseCsv(
      "Date,Amount,Note\n2026-08-01,-12.50,ok\nnope,-1.00,bad date\n2026-08-03,abc,bad amount\n",
    );
    const result = mapRows(parsed, CONFIG, [], REFERENCE);

    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    // Line numbers account for the header, so they match what the user sees.
    expect(result.errors[0]?.line).toBe(3);
    expect(result.errors[1]?.line).toBe(4);
  });

  it("rejects zero amounts", () => {
    const parsed = parseCsv("Date,Amount,Note\n2026-08-01,0.00,nothing\n");
    const result = mapRows(parsed, CONFIG, [], REFERENCE);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.message).toContain("zero");
  });

  it("flags rows that match an existing transaction", () => {
    const parsed = parseCsv("Date,Amount,Note\n2026-08-01,-12.50,Lidl\n");
    const result = mapRows(
      parsed,
      CONFIG,
      [{ occurredOn: "2026-08-01", amountMinor: toMinor(-1250), note: "Lidl" }],
      REFERENCE,
    );
    expect(result.valid[0]?.isDuplicate).toBe(true);
  });

  it("matches duplicates case-insensitively on the note", () => {
    const parsed = parseCsv("Date,Amount,Note\n2026-08-01,-12.50,LIDL\n");
    const result = mapRows(
      parsed,
      CONFIG,
      [{ occurredOn: "2026-08-01", amountMinor: toMinor(-1250), note: "lidl" }],
      REFERENCE,
    );
    expect(result.valid[0]?.isDuplicate).toBe(true);
  });

  it("flags a repeat within the same file, keeping the first occurrence clean", () => {
    const parsed = parseCsv(
      "Date,Amount,Note\n2026-08-01,-12.50,Lidl\n2026-08-01,-12.50,Lidl\n",
    );
    const result = mapRows(parsed, CONFIG, [], REFERENCE);
    expect(result.valid[0]?.isDuplicate).toBe(false);
    expect(result.valid[1]?.isDuplicate).toBe(true);
  });

  it("does not flag same-day same-note rows with different amounts", () => {
    const parsed = parseCsv(
      "Date,Amount,Note\n2026-08-01,-12.50,Lidl\n2026-08-01,-30.00,Lidl\n",
    );
    const result = mapRows(parsed, CONFIG, [], REFERENCE);
    expect(result.valid.every((row) => !row.isDuplicate)).toBe(true);
  });

  it("leaves the note null when no note column is mapped", () => {
    const parsed = parseCsv("Date,Amount\n2026-08-01,-12.50\n");
    const result = mapRows(
      parsed,
      { ...CONFIG, noteColumn: undefined },
      [],
      REFERENCE,
    );
    expect(result.valid[0]?.note).toBeNull();
  });
});

describe("toCsv", () => {
  it("writes a header row and quotes fields containing commas", () => {
    const csv = toCsv([
      {
        date: "2026-08-01",
        type: "expense",
        account: "Joint current",
        category: "Groceries",
        paidBy: "You",
        amount: "-12.50",
        currency: "EUR",
        amountBase: "-12.50",
        merchant: "Lidl",
        note: "big shop, for the party",
      },
    ]);

    expect(csv.split("\n")[0]).toBe(
      "date,type,account,category,paidBy,amount,currency,amountBase,merchant,note",
    );
    expect(csv).toContain('Lidl,"big shop, for the party"');
  });
});
