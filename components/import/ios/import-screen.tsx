"use client";

import { skCategoryKeyForName } from "@/lib/merchants";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { commitImport, previewImport } from "@/app/(app)/import/actions";
import { BANK_PRESETS, guessColumns, parseCsv, type MappedRow } from "@/lib/csv";
import type { ImportCategory } from "@/lib/import-queries";
import { categorySymbol } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { ProminentButton } from "@/components/ios/glass";
import { ListRow, SymbolTile } from "@/components/ios/list";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";
import {
  ColumnsSheet,
  NONE,
  type Mapping,
} from "@/components/import/ios/columns-sheet";
import { cn } from "@/lib/utils";

export interface ImportAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly isDefault: boolean;
}

/** Rows shown before «3 из 42» is tapped to show the rest. */
const PEEK = 3;

interface LoadedFile {
  readonly csv: string;
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: number;
}

/** The preset's column guesses applied to a mapping, as the old importer did. */
function applyPreset(mapping: Mapping, headers: readonly string[], bankId: string): Mapping {
  const preset = BANK_PRESETS.find((item) => item.id === bankId) ?? BANK_PRESETS[0];
  if (preset === undefined || headers.length === 0) return { ...mapping, bankId };
  const guessed = guessColumns(headers, preset);
  return {
    ...mapping,
    bankId,
    dateColumn: guessed.date,
    amountColumn: guessed.amount,
    noteColumn: guessed.note === "" ? NONE : guessed.note,
    dateFormat: preset.dateFormat,
  };
}

/**
 * Импорт выписки (board EL06). One card holds the file: a drop zone with the
 * upload glyph that, once a CSV is read, names it and counts its rows. The
 * bank preset maps the columns on its own, so the preview — what each row
 * will become, «30.09 → Potraviny», an unknown category in orange — appears
 * straight away and the only thing left is the import button. Bank, account
 * and the column mapping stay one row away for the files the presets miss.
 *
 * Parsing, mapping, duplicate detection and the write are the existing
 * previewImport / commitImport actions and lib/csv, unchanged.
 */
export function ImportScreen({
  accounts,
  categories,
}: {
  readonly accounts: readonly ImportAccount[];
  readonly categories: readonly ImportCategory[];
}) {
  const t = useTranslations("ios.import");
  const f = useFormats();
  const locale = useLocale();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({
    bankId: BANK_PRESETS[0]?.id ?? "generic",
    accountId: (accounts.find((a) => a.isDefault) ?? accounts[0])?.id ?? "",
    dateColumn: "",
    amountColumn: "",
    noteColumn: NONE,
    categoryColumn: NONE,
    dateFormat: "dmy",
    skipDuplicates: true,
  });

  const preview = useAction(previewImport, {
    onError: ({ error }) => {
      toast.error(error.serverError ?? t("couldNotRead"));
    },
  });
  const commit = useAction(commitImport, {
    onSuccess: ({ data }) => {
      toast.success(
        data.skipped > 0
          ? t("importedSkipped", { count: data.imported, skipped: data.skipped })
          : t("imported", { count: data.imported }),
      );
      setFile(null);
      setExpanded(false);
      preview.reset();
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? t("couldNotImport"));
    },
  });

  const payload = (csv: string, m: Mapping) => ({
    csv,
    accountId: m.accountId,
    dateColumn: m.dateColumn,
    amountColumn: m.amountColumn,
    ...(m.noteColumn === NONE ? {} : { noteColumn: m.noteColumn }),
    ...(m.categoryColumn === NONE ? {} : { categoryColumn: m.categoryColumn }),
    dateFormat: m.dateFormat,
    skipDuplicates: m.skipDuplicates,
  });

  /** Re-read with a new mapping; the preview is always of the current one. */
  const remap = (next: Mapping, loaded: LoadedFile | null = file) => {
    setMapping(next);
    setExpanded(false);
    if (loaded === null) return;
    if (next.accountId !== "" && next.dateColumn !== "" && next.amountColumn !== "") {
      preview.execute(payload(loaded.csv, next));
    } else {
      preview.reset();
    }
  };

  const onFile = (picked: File) => {
    void picked.text().then((text) => {
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        toast.error(t("noHeaderRow"));
        return;
      }
      const loaded: LoadedFile = {
        csv: text,
        name: picked.name,
        headers: parsed.headers,
        rows: parsed.rows.length,
      };
      // A category column, when the bank exports one, wins over the
      // merchant guess — the same lookup the old importer made.
      const categoryColumn =
        parsed.headers.find((header) =>
          ["kategór", "kategor", "category"].some((needle) =>
            header.toLowerCase().includes(needle),
          ),
        ) ?? NONE;
      const next = applyPreset({ ...mapping, categoryColumn }, parsed.headers, mapping.bankId);
      setFile(loaded);
      remap(next, loaded);
      if (next.dateColumn === "" || next.amountColumn === "") {
        toast.message(t("mapColumns"));
        setColumnsOpen(true);
      }
    });
  };

  const result = file === null ? undefined : preview.result.data;
  const byName = new Map(categories.map((c) => [c.matchKey, c]));
  // Same fallback as commitImport: the catalogue key is the shipped slug.
  const bySlug = new Map(
    categories.flatMap((c) => (c.slug === null ? [] : [[c.slug, c] as const])),
  );
  // The same resolution commitImport makes: the file's category first, then
  // the recognised merchant's; no match lands uncategorised.
  const categoryOf = (row: MappedRow) => {
    const fromFile = row.categoryName === null ? undefined : byName.get(row.categoryName.toLowerCase());
    const fromMerchant =
      row.suggestedCategory === null
        ? undefined
        : (byName.get(row.suggestedCategory.toLowerCase()) ??
          bySlug.get(skCategoryKeyForName(row.suggestedCategory) ?? ""));
    return fromFile ?? fromMerchant ?? null;
  };
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" });
  const toImport =
    result === undefined
      ? 0
      : mapping.skipDuplicates
        ? result.validCount - result.duplicateCount
        : result.validCount;
  const rows = result === undefined ? [] : expanded ? result.valid : result.valid.slice(0, PEEK);
  const account = accounts.find((a) => a.id === mapping.accountId);
  const bank = BANK_PRESETS.find((item) => item.id === mapping.bankId);
  const columnsSummary = [mapping.dateColumn, mapping.amountColumn, mapping.noteColumn]
    .filter((column) => column !== "" && column !== NONE)
    .join(" · ");

  if (accounts.length === 0) {
    return (
      <>
        <NavBar title={t("title")} back={{ href: "/more", label: t("more") }} />
        <ScreenBody className="pt-3">
          <div className="inset-group flex flex-col items-center gap-3 p-6 text-center">
            <Symbol name="account_balance_wallet" size={44} className="text-label-3" />
            <p className="t-headline">{t("needAccountTitle")}</p>
            <p className="t-subhead text-label-2">{t("needAccountBody")}</p>
            <Link href="/accounts" transitionTypes={["ios-push"]} className="t-body text-tint">
              {t("goToAccounts")}
            </Link>
          </div>
        </ScreenBody>
      </>
    );
  }

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: t("more") }} />

      <ScreenBody className="gap-5 pt-3">
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked !== undefined) onFile(picked);
            // Picking the same file again must still fire a change.
            event.target.value = "";
          }}
        />

        <div className="inset-group p-3.5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped !== undefined) onFile(dropped);
            }}
            className={cn(
              "bg-ios-fill-3 flex flex-col items-center gap-3 rounded-[18px] px-4 pt-[22px] pb-[18px] text-center transition-shadow",
              dragging && "shadow-[inset_0_0_0_2px_var(--ios-tint)]",
            )}
          >
            <span className="bg-tint-soft text-tint grid size-14 place-items-center rounded-full">
              <Symbol name="upload_file" size={28} />
            </span>
            <span className="flex max-w-full flex-col items-center gap-[3px]">
              <span className="max-w-full truncate text-[16px] leading-[21px] font-semibold tracking-[-0.0125em]">
                {file?.name ?? t("pickTitle")}
              </span>
              <span className="text-label-2 text-[14px] leading-[18px] tracking-[-0.007em]">
                {file === null ? t("pickHint") : t("rows", { count: file.rows })}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                input.current?.click();
              }}
              className="bg-ios-card text-tint press h-9 rounded-full px-4 text-[15px] font-semibold tracking-[-0.013em]"
            >
              {file === null ? t("pick") : t("pickOther")}
            </button>
          </div>
        </div>

        {result !== undefined && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2 px-4">
                <h2 className="t-title3 min-w-0 flex-1 truncate">{t("preview")}</h2>
                {result.validCount > PEEK && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => {
                      setExpanded((value) => !value);
                    }}
                    className="t-body text-label-2"
                  >
                    {expanded
                      ? t("collapse")
                      : t("shownOf", { shown: PEEK, total: result.validCount })}
                  </button>
                )}
              </div>
              {rows.length > 0 && (
                <div className="inset-group">
                  {rows.map((row) => {
                    const category = categoryOf(row);
                    const date = dayMonth.format(new Date(`${row.occurredOn}T12:00:00`));
                    return (
                      <div
                        key={row.line}
                        className={cn(
                          "flex min-h-16 items-center gap-3 pl-4",
                          row.isDuplicate && mapping.skipDuplicates && "opacity-45",
                        )}
                      >
                        {category === null ? (
                          <SymbolTile icon="question_mark" color="var(--ios-orange)" />
                        ) : (
                          <SymbolTile
                            icon={categorySymbol(category.icon, category.slug)}
                            color={category.color}
                          />
                        )}
                        <span className="row-sep flex min-h-16 min-w-0 flex-1 items-center gap-2.5 self-stretch py-2 pr-4">
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-[16px] leading-[21px] font-medium tracking-[-0.019em]">
                              {row.merchant ?? row.note ?? t("noDescription")}
                            </span>
                            <span
                              className={cn(
                                "t-footnote truncate",
                                category === null ? "text-ios-orange" : "text-label-2",
                              )}
                            >
                              {row.isDuplicate
                                ? t("duplicateMeta", { date })
                                : t("mapping", { date, category: category?.name ?? t("noCategory") })}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "money shrink-0 text-[16px] font-semibold tracking-[-0.019em] whitespace-nowrap",
                              row.amountMinor > 0 && "text-ios-green",
                            )}
                          >
                            {minus(f.money(row.amountMinor, result.currency, { signed: true }))}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="t-footnote text-label-2 px-4 pt-1">
                {mapping.skipDuplicates
                  ? t("duplicatesSkipped", { count: result.duplicateCount })
                  : t("duplicatesKept", { count: result.duplicateCount })}
              </p>
              {result.errorCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setColumnsOpen(true);
                  }}
                  className="t-footnote text-ios-red px-4 text-left"
                >
                  {t("unreadable", { count: result.errorCount })}
                </button>
              )}
            </div>

            <ProminentButton
              className="h-14"
              disabled={toImport === 0 || commit.isPending}
              pending={commit.isPending}
              onClick={() => {
                commit.execute(payload(file?.csv ?? "", mapping));
              }}
            >
              {commit.isPending ? t("importing") : t("importCount", { count: toImport })}
            </ProminentButton>
          </>
        )}

        {file !== null && result === undefined && preview.isPending && (
          <p className="t-footnote text-label-2 px-4 text-center">{t("reading")}</p>
        )}

        <section className="flex flex-col gap-2">
          <div className="inset-group">
            <ListRow
              title={t("bank")}
              accessory="none"
              trailing={
                <GlassMenu
                  label={t("bank")}
                  trigger={
                    <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
                      <span className="max-w-[46vw] truncate">{bank?.label ?? ""}</span>
                      <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
                    </button>
                  }
                  entries={BANK_PRESETS.map((preset) => ({
                    key: preset.id,
                    label: preset.label,
                    checked: preset.id === mapping.bankId,
                    onSelect: () => {
                      remap(applyPreset(mapping, file?.headers ?? [], preset.id));
                    },
                  }))}
                />
              }
            />
            <ListRow
              title={t("account")}
              accessory="none"
              trailing={
                <GlassMenu
                  label={t("account")}
                  trigger={
                    <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
                      <span className="max-w-[46vw] truncate">{account?.name ?? ""}</span>
                      <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
                    </button>
                  }
                  entries={accounts.map((item) => ({
                    key: item.id,
                    label: item.name,
                    sublabel: item.currency,
                    checked: item.id === mapping.accountId,
                    onSelect: () => {
                      remap({ ...mapping, accountId: item.id });
                    },
                  }))}
                />
              }
            />
            {file !== null && (
              <ListRow
                title={t("columns")}
                value={columnsSummary === "" ? t("notMapped") : columnsSummary}
                onClick={() => {
                  setColumnsOpen(true);
                }}
              />
            )}
          </div>
          <p className="t-footnote text-label-2 px-4 pt-0.5">{t("bankHint")}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="t-footnote text-label-2 px-4 uppercase">{t("export")}</h2>
          <div className="inset-group">
            <a
              href="/api/export/transactions.csv"
              download
              className="press-row flex w-full items-center gap-3.5 pl-4"
            >
              <SymbolTile icon="download" color="var(--ios-green)" />
              <span className="row-sep t-body flex min-h-[52px] flex-1 items-center pr-4">
                {t("exportCsv")}
              </span>
            </a>
            <a
              href="/api/export/household.json"
              download
              className="press-row flex w-full items-center gap-3.5 pl-4"
            >
              <SymbolTile icon="download" color="var(--ios-gray)" />
              <span className="row-sep t-body flex min-h-[52px] flex-1 items-center pr-4">
                {t("exportJson")}
              </span>
            </a>
          </div>
        </section>
      </ScreenBody>

      <ColumnsSheet
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        headers={file?.headers ?? []}
        mapping={mapping}
        errors={result?.errors ?? []}
        errorCount={result?.errorCount ?? 0}
        onChange={(next) => {
          remap(next);
        }}
      />
    </>
  );
}
