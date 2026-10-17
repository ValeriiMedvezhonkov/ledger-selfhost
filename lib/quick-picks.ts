/**
 * Shapes for the quick row of the add-transaction form.
 *
 * Kept out of the action module because a `"use server"` file may only export
 * async functions — a plain constant there is a build error, not a lint nit.
 */

/**
 * More than this and the row wraps to three lines on a phone, at which point
 * scanning it costs more than picking the category from the full list.
 */
export const MAX_QUICK_PICKS = 8;

export interface QuickPick {
  /** Stable key for rendering. */
  readonly id: string;
  /** What the chip says: the category's name. */
  readonly label: string;
  readonly categoryId: string;
  readonly slug: string | null;
  readonly icon: string | null;
  readonly color: string;
  /** Pinned by hand, as opposed to inferred from spending. */
  readonly pinned: boolean;
}

export interface QuickCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly icon: string;
  readonly kind: "income" | "expense";
  readonly color: string;
}
