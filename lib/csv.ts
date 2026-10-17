import Papa from "papaparse";
import { parse as parseDate, isValid } from "date-fns";
import { parseMoneyInput, type Minor } from "@/lib/money";
import { ISO_DATE_PATTERN, toISODate, type ISODate } from "@/lib/date";
import { matchMerchant } from "@/lib/merchants";

/**
 * CSV import. Deliberately boring and explicit: banks disagree about column
 * names, date order and decimal separators, so the user maps columns by hand and
 * sees every row that failed to parse *before* anything is written.
 */

export type DateFormat = "iso" | "dmy" | "mdy";

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const headers = result.meta.fields ?? [];
  const rows = result.data.filter((row) =>
    Object.values(row).some((value) => value.trim() !== ""),
  );

  return { headers, rows };
}

const DATE_PATTERNS: Readonly<Record<DateFormat, readonly string[]>> = {
  iso: ["yyyy-MM-dd", "yyyy/MM/dd"],
  // Slovak banks write 19.08.2026 or 19. 8. 2026, so the spaced variants matter.
  dmy: [
    "dd/MM/yyyy",
    "dd.MM.yyyy",
    "d.M.yyyy",
    "dd. MM. yyyy",
    "d. M. yyyy",
    "dd-MM-yyyy",
  ],
  mdy: ["MM/dd/yyyy", "M/d/yyyy", "MM-dd-yyyy"],
};

/**
 * Column-name hints for the banks people actually use in Slovakia. Exports
 * differ per bank and per language setting, so each entry lists every header
 * spelling seen in the wild; the importer picks the first that matches.
 */
export interface BankPreset {
  readonly id: string;
  readonly label: string;
  readonly dateFormat: DateFormat;
  readonly date: readonly string[];
  readonly amount: readonly string[];
  readonly note: readonly string[];
}

export const BANK_PRESETS: readonly BankPreset[] = [
  {
    id: "slsp",
    label: "Slovenská sporiteľňa",
    dateFormat: "dmy",
    date: ["dátum zúčtovania", "datum zuctovania", "dátum", "datum"],
    amount: ["suma", "čiastka", "ciastka"],
    note: ["poznámka", "poznamka", "názov príjemcu", "popis", "detail platby"],
  },
  {
    id: "vub",
    label: "VÚB banka",
    dateFormat: "dmy",
    date: ["dátum splatnosti", "dátum", "datum"],
    amount: ["suma", "suma v mene účtu"],
    note: ["popis", "poznámka", "správa pre prijímateľa", "partner"],
  },
  {
    id: "tatra",
    label: "Tatra banka",
    dateFormat: "dmy",
    date: ["dátum vysporiadania", "dátum obchodu", "dátum", "datum"],
    amount: ["suma", "suma obchodu"],
    note: ["poznámka", "popis", "názov obchodníka", "protistrana"],
  },
  {
    id: "csob",
    label: "ČSOB",
    dateFormat: "dmy",
    date: ["dátum zaúčtovania", "dátum", "datum"],
    amount: ["suma", "čiastka"],
    note: ["popis transakcie", "popis", "poznámka"],
  },
  {
    id: "365",
    label: "365.bank / Poštová banka",
    dateFormat: "dmy",
    date: ["dátum zúčtovania", "dátum", "datum"],
    amount: ["suma", "suma transakcie"],
    note: ["popis", "poznámka", "názov protiúčtu"],
  },
  {
    id: "mbank",
    label: "mBank",
    dateFormat: "dmy",
    date: ["dátum operácie", "dátum", "datum operacji"],
    amount: ["suma operácie", "suma", "kwota"],
    note: ["popis operácie", "popis", "opis operacji"],
  },
  {
    id: "revolut",
    label: "Revolut",
    dateFormat: "iso",
    date: ["completed date", "started date", "date"],
    amount: ["amount"],
    note: ["description"],
  },
  {
    id: "generic",
    label: "Iná banka / vlastný súbor",
    dateFormat: "dmy",
    date: ["dátum", "datum", "date", "booking date"],
    amount: ["suma", "amount", "čiastka", "value"],
    note: ["popis", "poznámka", "description", "note", "detail", "payee"],
  },
];

/**
 * Best-guess column mapping for a set of headers. Exact matches win over
 * substring matches, so a file with both "Dátum" and "Dátum splatnosti" picks
 * the one the preset names first.
 */
export function guessColumns(
  headers: readonly string[],
  preset: BankPreset,
): { date: string; amount: string; note: string } {
  const find = (candidates: readonly string[]): string => {
    const normalized = headers.map((header) => ({
      header,
      key: header.trim().toLowerCase(),
    }));

    for (const candidate of candidates) {
      const exact = normalized.find((item) => item.key === candidate);
      if (exact) return exact.header;
    }
    for (const candidate of candidates) {
      const partial = normalized.find((item) => item.key.includes(candidate));
      if (partial) return partial.header;
    }
    return "";
  };

  return {
    date: find(preset.date),
    amount: find(preset.amount),
    note: find(preset.note),
  };
}

export function parseCsvDate(
  raw: string,
  format: DateFormat,
  reference: Date,
): ISODate | null {
  const text = raw.trim();
  if (text === "") return null;

  if (ISO_DATE_PATTERN.test(text)) return text;

  for (const pattern of DATE_PATTERNS[format]) {
    const parsed = parseDate(text, pattern, reference);
    if (isValid(parsed)) return toISODate(parsed);
  }

  return null;
}

export interface MappedRow {
  readonly line: number;
  readonly occurredOn: ISODate;
  readonly amountMinor: Minor;
  readonly note: string | null;
  /** From the file's own category column, when one was mapped. */
  readonly categoryName: string | null;
  /** Recognised Slovak merchant, e.g. "Lidl" from "NAKUP KARTOU LIDL SK". */
  readonly merchant: string | null;
  /** Category inferred from that merchant, used when the file has none. */
  readonly suggestedCategory: string | null;
  readonly isDuplicate: boolean;
}

export interface RowError {
  readonly line: number;
  readonly message: string;
  readonly raw: string;
}

export interface MappingResult {
  readonly valid: readonly MappedRow[];
  readonly errors: readonly RowError[];
}

export interface MappingConfig {
  readonly dateColumn: string;
  readonly amountColumn: string;
  readonly noteColumn?: string | undefined;
  readonly categoryColumn?: string | undefined;
  readonly dateFormat: DateFormat;
  readonly currency: string;
}

/** A transaction already in the ledger, for duplicate detection. */
export interface ExistingKey {
  readonly occurredOn: ISODate;
  readonly amountMinor: Minor;
  readonly note: string | null;
}

function duplicateKey(
  occurredOn: string,
  amountMinor: number,
  note: string | null,
): string {
  return `${occurredOn}|${amountMinor}|${(note ?? "").trim().toLowerCase()}`;
}

export function mapRows(
  parsed: ParsedCsv,
  config: MappingConfig,
  existing: readonly ExistingKey[],
  reference: Date,
): MappingResult {
  const valid: MappedRow[] = [];
  const errors: RowError[] = [];

  const seen = new Set(
    existing.map((row) =>
      duplicateKey(row.occurredOn, row.amountMinor, row.note),
    ),
  );

  parsed.rows.forEach((row, index) => {
    // +2: one for the header line, one for 1-based line numbers.
    const line = index + 2;
    const rawDate = row[config.dateColumn] ?? "";
    const rawAmount = row[config.amountColumn] ?? "";

    const occurredOn = parseCsvDate(rawDate, config.dateFormat, reference);
    if (occurredOn === null) {
      errors.push({
        line,
        message: `Could not read the date "${rawDate}"`,
        raw: rawDate,
      });
      return;
    }

    const amount = parseMoneyInput(rawAmount, config.currency);
    if (!amount.ok) {
      errors.push({
        line,
        message: `${amount.error} ("${rawAmount}")`,
        raw: rawAmount,
      });
      return;
    }

    if (amount.value === 0) {
      errors.push({ line, message: "Amount is zero", raw: rawAmount });
      return;
    }

    const note =
      config.noteColumn !== undefined
        ? ((row[config.noteColumn] ?? "").trim() || null)
        : null;

    const categoryName =
      config.categoryColumn !== undefined
        ? ((row[config.categoryColumn] ?? "").trim() || null)
        : null;

    const key = duplicateKey(occurredOn, amount.value, note);
    const isDuplicate = seen.has(key);
    seen.add(key);

    // Recognise the merchant from the raw description so an import of a bank
    // statement arrives categorised instead of as a wall of Nezaradené.
    const matched = note === null ? null : matchMerchant(note);

    valid.push({
      line,
      occurredOn,
      amountMinor: amount.value,
      note,
      categoryName,
      merchant: matched?.merchant ?? null,
      suggestedCategory: matched?.categoryName ?? null,
      isDuplicate,
    });
  });

  return { valid, errors };
}

// --- export ---------------------------------------------------------------

export interface ExportRow {
  readonly date: string;
  readonly type: string;
  readonly account: string;
  readonly category: string;
  readonly paidBy: string;
  readonly amount: string;
  readonly currency: string;
  readonly amountBase: string;
  readonly merchant: string;
  readonly note: string;
}

export function toCsv(rows: readonly ExportRow[]): string {
  return Papa.unparse(rows as ExportRow[], {
    newline: "\n",
    columns: [
      "date",
      "type",
      "account",
      "category",
      "paidBy",
      "amount",
      "currency",
      "amountBase",
      "merchant",
      "note",
    ],
  });
}
