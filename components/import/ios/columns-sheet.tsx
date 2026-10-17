"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DateFormat, RowError } from "@/lib/csv";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Switch } from "@/components/ios/controls";
import { GlassMenu } from "@/components/ios/menu";
import { Symbol } from "@/components/ios/symbol";

/** «Not in the file» for the optional columns. */
export const NONE = "__none";

/** Everything previewImport / commitImport need besides the file itself. */
export interface Mapping {
  readonly bankId: string;
  readonly accountId: string;
  readonly dateColumn: string;
  readonly amountColumn: string;
  readonly noteColumn: string;
  readonly categoryColumn: string;
  readonly dateFormat: DateFormat;
  readonly skipDuplicates: boolean;
}

const DATE_FORMATS: readonly DateFormat[] = ["dmy", "iso", "mdy"];

function Row({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="row-sep flex min-h-[52px] items-center gap-3 px-4">
      <span className="t-body shrink-0">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </div>
  );
}

/**
 * «Колонки»: the manual mapping the bank presets normally make unnecessary —
 * which header is the date, the amount, the description and the category,
 * how the dates are written, and whether rows already in the ledger are
 * skipped. Each change re-runs the preview behind the sheet, and the rows the
 * current mapping cannot read are listed underneath, so a wrong guess is
 * visible while it is being fixed.
 */
export function ColumnsSheet({
  open,
  onOpenChange,
  headers,
  mapping,
  errors,
  errorCount,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly headers: readonly string[];
  readonly mapping: Mapping;
  readonly errors: readonly RowError[];
  readonly errorCount: number;
  readonly onChange: (next: Mapping) => void;
}) {
  const t = useTranslations("ios.import");

  const column = (
    key: "dateColumn" | "amountColumn" | "noteColumn" | "categoryColumn",
    label: string,
    optional: boolean,
  ) => {
    const value = mapping[key];
    const shown = value === "" ? t("choose") : value === NONE ? t("notInFile") : value;
    return (
      <Row label={label}>
        <GlassMenu
          label={label}
          trigger={
            <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
              <span className="truncate">{shown}</span>
              <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
            </button>
          }
          entries={[
            ...(optional
              ? [
                  {
                    key: NONE,
                    label: t("notInFile"),
                    checked: value === NONE,
                    onSelect: () => {
                      onChange({ ...mapping, [key]: NONE });
                    },
                  },
                ]
              : []),
            ...headers.map((header) => ({
              key: header,
              label: header,
              checked: header === value,
              onSelect: () => {
                onChange({ ...mapping, [key]: header });
              },
            })),
          ]}
        />
      </Row>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} detent="medium" title={t("columns")}>
      <SheetHeader
        title={t("columns")}
        onClose={() => {
          onOpenChange(false);
        }}
      />
      <div className="flex max-h-[70dvh] flex-col gap-[22px] overflow-y-auto px-4 pt-3 pb-6 *:shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="inset-group">
            {column("dateColumn", t("dateColumn"), false)}
            {column("amountColumn", t("amountColumn"), false)}
            {column("noteColumn", t("noteColumn"), true)}
            {column("categoryColumn", t("categoryColumn"), true)}
            <Row label={t("dateFormat")}>
              <GlassMenu
                label={t("dateFormat")}
                trigger={
                  <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
                    <span className="truncate">{t(`formats.${mapping.dateFormat}`)}</span>
                    <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
                  </button>
                }
                entries={DATE_FORMATS.map((format) => ({
                  key: format,
                  label: t(`formats.${format}`),
                  checked: format === mapping.dateFormat,
                  onSelect: () => {
                    onChange({ ...mapping, dateFormat: format });
                  },
                }))}
              />
            </Row>
          </div>
          <p className="t-footnote text-label-2 px-4 pt-0.5">{t("columnsHint")}</p>
        </div>

        <div className="inset-group">
          <div className="flex min-h-[52px] items-center gap-3 px-4">
            <span className="t-body min-w-0 flex-1">{t("skipDuplicates")}</span>
            <Switch
              checked={mapping.skipDuplicates}
              label={t("skipDuplicates")}
              onChange={(next) => {
                onChange({ ...mapping, skipDuplicates: next });
              }}
            />
          </div>
        </div>

        {errorCount > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="t-footnote text-ios-red px-4 uppercase">
              {t("unreadableTitle", { count: errorCount })}
            </h3>
            <div className="inset-group">
              {errors.slice(0, 8).map((error) => (
                <div key={error.line} className="row-sep flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="t-footnote text-label-2 money shrink-0">
                    {t("line", { line: error.line })}
                  </span>
                  <span className="t-subhead min-w-0 flex-1 break-words">{error.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
