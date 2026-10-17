"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/app/(app)/categories/actions";
import { CATEGORY_COLOR_CHOICES } from "@/lib/chart-palette";
import { CATEGORY_SYMBOL, categorySymbol } from "@/lib/symbols";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { GlassButton } from "@/components/ios/glass";
import { Segmented } from "@/components/ios/controls";
import { ActionRow, SymbolTile } from "@/components/ios/list";
import { GlassMenu } from "@/components/ios/menu";
import { IosAlert } from "@/components/ios/alert";
import { Symbol } from "@/components/ios/symbol";
import { cn } from "@/lib/utils";

/** What the screen and the sheet need of a category row. */
export interface CategoryItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly kind: "income" | "expense";
  /** A Lucide name ("ShoppingCart"); older rows may hold an emoji or "Circle". */
  readonly icon: string;
  readonly color: string;
  readonly parentId: string | null;
  /** The fallback deleted categories' operations move to — never deletable. */
  readonly isSystem: boolean;
  readonly transactionCount: number;
}

/** Lucide names the picker offers, in the catalogue's order. */
const ICON_CHOICES = Object.keys(CATEGORY_SYMBOL);

/** A neutral glyph for a brand-new category (receipt), not a guessed one. */
const NEW_ICON = "ReceiptText";

const FALLBACK = "__fallback";

/**
 * The category editor: a large sheet with the tile previewed at the top in
 * the chosen colour and glyph, the name under it, then kind, colour, glyph,
 * parent and — for anything but the system fallback — delete, which first
 * asks where the category's operations should go.
 */
export function CategorySheet({
  open,
  formKey,
  category,
  categories,
  onClose,
}: {
  readonly open: boolean;
  /** Bumped per opening so the form starts from the row it was opened for. */
  readonly formKey: number;
  readonly category: CategoryItem | null;
  readonly categories: readonly CategoryItem[];
  readonly onClose: () => void;
}) {
  const t = useTranslations("ios.categories");
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={category === null ? t("new") : t("edit")}
    >
      <CategoryForm
        key={formKey}
        category={category}
        categories={categories}
        onClose={onClose}
      />
    </Sheet>
  );
}

function CategoryForm({
  category,
  categories,
  onClose,
}: {
  readonly category: CategoryItem | null;
  readonly categories: readonly CategoryItem[];
  readonly onClose: () => void;
}) {
  const t = useTranslations("ios.categories");
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<"income" | "expense">(category?.kind ?? "expense");
  const [icon, setIcon] = useState(category?.icon ?? NEW_ICON);
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLOR_CHOICES[0] ?? "#2a78d6");
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [reassignTo, setReassignTo] = useState<string>(FALLBACK);
  const [confirm, setConfirm] = useState(false);

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setConfirm(false);
      onClose();
      router.refresh();
    },
    onError: ({ error }: { error: { serverError?: string | undefined } }) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });
  const create = useAction(createCategory, done(t("added")));
  const update = useAction(updateCategory, done(t("updated")));
  const remove = useAction(deleteCategory, done(t("deleted")));
  const pending = create.isPending || update.isPending;

  /*
   * A colour stored before the palette was validated is still offered — first,
   * selected — so opening and saving an old category never silently recolours
   * it. Picking another swatch moves it into the validated set.
   */
  const colors =
    category !== null && !CATEGORY_COLOR_CHOICES.includes(category.color)
      ? [category.color, ...CATEGORY_COLOR_CHOICES]
      : CATEGORY_COLOR_CHOICES;

  // Only top-level categories of the same kind can be a parent.
  const parents = categories.filter(
    (item) =>
      item.id !== category?.id && item.kind === kind && item.parentId === null && !item.isSystem,
  );
  const parentName = parents.find((item) => item.id === parentId)?.name ?? t("noParent");
  const targets = categories.filter(
    (item) => item.id !== category?.id && item.kind === category?.kind,
  );
  const targetName =
    targets.find((item) => item.id === reassignTo)?.name ?? t("uncategorized");
  const used = category !== null && category.transactionCount > 0;
  const deletable = category !== null && !category.isSystem;

  const save = () => {
    const values = { name: name.trim(), kind, icon, color, parentId };
    if (category === null) create.execute(values);
    else update.execute({ ...values, id: category.id });
  };

  return (
    <>
      <SheetHeader
        title={category === null ? t("new") : t("edit")}
        onClose={onClose}
        trailing={
          <GlassButton
            icon="check"
            tinted
            label={t("save")}
            disabled={name.trim() === "" || pending}
            onClick={save}
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-4 pt-4 pb-10 *:shrink-0">
        <div className="inset-group flex flex-col items-center gap-4 p-[18px]">
          <SymbolTile icon={categorySymbol(icon, category?.slug ?? null)} color={color} size={76} />
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            maxLength={40}
            placeholder={t("namePlaceholder")}
            aria-label={t("name")}
            className="bg-ios-fill-3 placeholder:text-label-3 t-title3 h-[52px] w-full rounded-[14px] px-4 text-center outline-none"
          />
        </div>

        <Segmented<"income" | "expense">
          label={t("kind")}
          value={kind}
          onChange={(next) => {
            setKind(next);
            // A parent must be of the same kind; switching invalidates it.
            setParentId(null);
          }}
          options={[
            { value: "expense", label: t("kindExpense") },
            { value: "income", label: t("kindIncome") },
          ]}
        />

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 px-4 uppercase">{t("color")}</h3>
          <div className="inset-group grid grid-cols-8 justify-items-center gap-y-2 px-2.5 py-3.5">
            {colors.map((swatch) => {
              const selected = swatch.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  aria-pressed={selected}
                  onClick={() => {
                    setColor(swatch);
                  }}
                  className={cn(
                    "press grid size-9 place-items-center rounded-full border-[2.5px]",
                    !selected && "border-transparent",
                  )}
                  style={selected ? { borderColor: swatch } : undefined}
                >
                  <span className="size-[26px] rounded-full" style={{ backgroundColor: swatch }} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 px-4 uppercase">{t("icon")}</h3>
          <div className="inset-group grid grid-cols-6 justify-items-center gap-y-3 p-4">
            {ICON_CHOICES.map((choice) => {
              const selected = choice === icon;
              const glyph = CATEGORY_SYMBOL[choice] ?? "category";
              return (
                <button
                  key={choice}
                  type="button"
                  aria-label={glyph}
                  aria-pressed={selected}
                  onClick={() => {
                    setIcon(choice);
                  }}
                  className={cn(
                    "press grid size-11 place-items-center rounded-full transition-colors",
                    selected ? "text-white" : "bg-ios-fill-3 text-label-2",
                  )}
                  style={selected ? { backgroundColor: color } : undefined}
                >
                  <Symbol name={glyph} size={22} weight={600} />
                </button>
              );
            })}
          </div>
        </section>

        {parents.length > 0 && (
          <div className="inset-group">
            <div className="flex min-h-[52px] items-center gap-2 px-4">
              <span className="t-body min-w-0 flex-1">{t("parent")}</span>
              <GlassMenu
                label={t("parent")}
                trigger={
                  <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
                    <span className="truncate">{parentName}</span>
                    <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
                  </button>
                }
                entries={[
                  {
                    key: "none",
                    label: t("noParent"),
                    checked: parentId === null,
                    onSelect: () => {
                      setParentId(null);
                    },
                  },
                  ...parents.map((item) => ({
                    key: item.id,
                    label: item.name,
                    checked: item.id === parentId,
                    onSelect: () => {
                      setParentId(item.id);
                    },
                  })),
                ]}
              />
            </div>
          </div>
        )}

        {category?.isSystem === true && (
          <p className="t-footnote text-label-2 px-4">{t("systemHint")}</p>
        )}

        {deletable && (
          <section className="flex flex-col gap-1.5">
            {used && (
              <div className="inset-group mb-2">
                <div className="flex min-h-[52px] items-center gap-2 px-4">
                  <span className="t-body min-w-0 flex-1">{t("moveTo")}</span>
                  <GlassMenu
                    label={t("moveTo")}
                    trigger={
                      <button type="button" className="t-body text-label-2 flex min-w-0 items-center gap-0.5">
                        <span className="truncate">{targetName}</span>
                        <Symbol name="unfold_more" size={18} weight={600} className="text-label-3" />
                      </button>
                    }
                    entries={[
                      {
                        key: FALLBACK,
                        label: t("uncategorized"),
                        checked: reassignTo === FALLBACK,
                        onSelect: () => {
                          setReassignTo(FALLBACK);
                        },
                      },
                      ...targets.map((item) => ({
                        key: item.id,
                        label: item.name,
                        checked: item.id === reassignTo,
                        onSelect: () => {
                          setReassignTo(item.id);
                        },
                      })),
                    ]}
                  />
                </div>
              </div>
            )}
            <ActionRow
              destructive
              onClick={() => {
                setConfirm(true);
              }}
            >
              {t("delete")}
            </ActionRow>
            <p className="t-footnote text-label-2 px-4 pt-0.5">
              {used
                ? t("moveHint", { count: category.transactionCount })
                : t("unusedHint")}
            </p>
          </section>
        )}
      </div>

      {category !== null && (
        <IosAlert
          open={confirm}
          onOpenChange={setConfirm}
          title={t("confirmTitle", { name: category.name })}
          message={
            used
              ? t("confirmUsed", { count: category.transactionCount, target: targetName })
              : t("confirmUnused")
          }
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteShort")}
          pending={remove.isPending}
          onConfirm={() => {
            remove.execute({
              id: category.id,
              reassignToId: reassignTo === FALLBACK ? null : reassignTo,
            });
          }}
        />
      )}
    </>
  );
}
