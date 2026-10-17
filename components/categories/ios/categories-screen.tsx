"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { categorySymbol } from "@/lib/symbols";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton } from "@/components/ios/glass";
import { ListRow, SymbolTile } from "@/components/ios/list";
import { CategorySheet, type CategoryItem } from "@/components/categories/ios/category-sheet";

/**
 * How many rows a section shows before folding the rest behind «И ещё N».
 * Ten fills one screen at 52pt rows, which is the point of folding: the
 * income section and the add row stay within reach without a long scroll.
 */
const FOLD_AT = 10;

/** «РАСХОДЫ · 22»: the plain small-caps header UITableView draws. */
function GroupHeader({ children }: { readonly children: ReactNode }) {
  return <h2 className="t-footnote text-label-2 px-4 uppercase">{children}</h2>;
}

/**
 * Категории (board EL04). Two inset groups — expense, then income — of
 * coloured glyph tiles, the busiest categories first so the fold hides the
 * ones nobody uses; a tap opens the edit sheet, «＋» a blank one.
 */
export function CategoriesScreen({
  categories,
}: {
  readonly categories: readonly CategoryItem[];
}) {
  const t = useTranslations("ios.categories");
  /*
   * `undefined` = closed, `null` = a new category, otherwise the one being
   * edited. The sheet stays mounted while it animates out, so the last value
   * is kept in `shown` rather than cleared on close.
   */
  const [editing, setEditing] = useState<CategoryItem | null | undefined>(undefined);
  const [shown, setShown] = useState<CategoryItem | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const open = (category: CategoryItem | null) => {
    setShown(category);
    setSheetKey((key) => key + 1);
    setEditing(category);
  };

  // Most-used first: the fold is only useful if what it hides is what is
  // rarely picked. Name breaks ties so the order is stable between visits.
  const byUse = (a: CategoryItem, b: CategoryItem) =>
    b.transactionCount - a.transactionCount || a.name.localeCompare(b.name);
  const expense = categories.filter((c) => c.kind === "expense").sort(byUse);
  const income = categories.filter((c) => c.kind === "income").sort(byUse);
  const folded = !expanded && expense.length > FOLD_AT + 1;
  const visibleExpense = folded ? expense.slice(0, FOLD_AT) : expense;

  const row = (category: CategoryItem) => (
    <ListRow
      key={category.id}
      title={category.name}
      tile={{ icon: categorySymbol(category.icon, category.slug), color: category.color }}
      onClick={() => {
        open(category);
      }}
    />
  );

  return (
    <>
      <NavBar
        title={t("title")}
        back={{ href: "/more", label: t("more") }}
        trailing={
          <GlassButton
            icon="add"
            iconSize={26}
            label={t("add")}
            onClick={() => {
              open(null);
            }}
          />
        }
      />

      <ScreenBody className="gap-[18px] pt-3">
        {expense.length > 0 && (
          <section className="flex flex-col gap-2">
            <GroupHeader>{t("expenses", { count: expense.length })}</GroupHeader>
            <div className="inset-group">
              {visibleExpense.map(row)}
              {folded ? (
                <ListRow
                  title={t("andMore", { count: expense.length - FOLD_AT })}
                  tinted
                  tile={
                    <SymbolTile
                      icon="more_horiz"
                      color="var(--ios-fill-2)"
                      className="text-label-2"
                    />
                  }
                  onClick={() => {
                    setExpanded(true);
                  }}
                />
              ) : (
                expanded && (
                  <ListRow
                    title={t("showLess")}
                    tinted
                    accessory="none"
                    tile={
                      <SymbolTile
                        icon="expand_less"
                        color="var(--ios-fill-2)"
                        className="text-label-2"
                      />
                    }
                    onClick={() => {
                      setExpanded(false);
                    }}
                  />
                )
              )}
            </div>
          </section>
        )}

        {income.length > 0 && (
          <section className="flex flex-col gap-2">
            <GroupHeader>{t("incomes", { count: income.length })}</GroupHeader>
            <div className="inset-group">{income.map(row)}</div>
          </section>
        )}

        <div className="inset-group">
          <ListRow
            title={t("addRow")}
            tinted
            accessory="none"
            tile={
              <SymbolTile icon="add" color="var(--ios-tint-soft)" className="text-tint" />
            }
            onClick={() => {
              open(null);
            }}
          />
        </div>
      </ScreenBody>

      <CategorySheet
        formKey={sheetKey}
        open={editing !== undefined}
        category={shown}
        categories={categories}
        onClose={() => {
          setEditing(undefined);
        }}
      />
    </>
  );
}
