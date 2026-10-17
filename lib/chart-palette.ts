/**
 * Chart colour parameters.
 *
 * These are not chosen by eye. The eight categorical slots and the diverging
 * pair were run through the data-viz validator against this app's real chart
 * surfaces (light `#ffffff`, dark `#171717`) and pass the lightness band,
 * chroma floor, adjacent-pair CVD separation and normal-vision floor in both
 * modes:
 *
 *   light — worst adjacent CVD ΔE 9.1, worst adjacent normal ΔE 19.6
 *   dark  — worst adjacent CVD ΔE 8.4, worst adjacent normal ΔE 19.3
 *
 * Light mode reports three slots below 3:1 contrast (aqua, yellow, magenta).
 * That triggers the relief rule, which is why every chart using these colours
 * ships visible labels or an accompanying ranked list — colour is never the
 * only way to read a value here.
 *
 * Slot order IS the CVD-safety mechanism. Assign in order; never cycle, never
 * reorder, never generate a ninth hue — a ninth series folds into "Other".
 */

export interface ColorPair {
  readonly light: string;
  readonly dark: string;
}

/** Fixed categorical order. Index 0 is assigned first. */
export const CATEGORICAL_SLOTS: readonly ColorPair[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

/** The hexes offered in the category colour picker, in slot order. */
export const CATEGORY_COLOR_CHOICES: readonly string[] = CATEGORICAL_SLOTS.map(
  (slot) => slot.light,
);

/** Everything past slot 8 collapses into this. */
export const OTHER_COLOR: ColorPair = { light: "#898781", dark: "#898781" };

/**
 * Diverging poles for income vs expense. Warm/cool reads as genuinely opposite,
 * which is the relationship being shown. These are the palette's diverging pair,
 * not the reserved status colours — a series must never impersonate a status.
 */
export const INCOME_COLOR: ColorPair = { light: "#2a78d6", dark: "#3987e5" };
export const EXPENSE_COLOR: ColorPair = { light: "#e34948", dark: "#e66767" };

/** Single-series magnitude (net worth, spending trend): one hue. */
export const SEQUENTIAL_COLOR: ColorPair = { light: "#2a78d6", dark: "#3987e5" };

/**
 * Map an arbitrary stored colour onto the nearest validated slot.
 *
 * Categories carry a user-chosen colour. Rather than trust an arbitrary hex to
 * be CVD-safe next to its neighbours, chart series resolve through the slot
 * list; anything unrecognised falls back by position so colour still follows
 * the entity rather than its rank.
 */
export function resolveSlot(color: string, fallbackIndex: number): ColorPair {
  const normalized = color.trim().toLowerCase();
  const match = CATEGORICAL_SLOTS.find(
    (slot) => slot.light.toLowerCase() === normalized,
  );
  if (match) return match;

  if (fallbackIndex >= CATEGORICAL_SLOTS.length) return OTHER_COLOR;
  return CATEGORICAL_SLOTS[fallbackIndex] ?? OTHER_COLOR;
}

/** Chart chrome. Recessive by design — grid and axes must not compete. */
export const CHART_INK = {
  grid: { light: "#e1e0d9", dark: "#2c2c2a" },
  axis: { light: "#898781", dark: "#898781" },
} as const;

/** How many series a categorical chart shows before folding into "Other". */
export const MAX_SERIES = 8;
