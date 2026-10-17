import type { SymbolName } from "@/lib/symbols";

export interface GoalLook {
  readonly color: string;
  readonly icon: SymbolName;
}

/*
 * Goals have no icon or colour column, and three goals do not need a picker
 * (the same call the accounts screen makes for its type glyphs). Each goal
 * gets a tile from this rotation instead — in the order the boards draw them:
 * orange beach umbrella, blue shield, pink festival.
 */
const ROTATION: readonly GoalLook[] = [
  { color: "var(--ios-orange)", icon: "beach_access" },
  { color: "var(--ios-blue)", icon: "shield" },
  { color: "var(--ios-pink)", icon: "festival" },
  { color: "var(--ios-green)", icon: "savings" },
  { color: "var(--ios-purple)", icon: "flight" },
  { color: "var(--ios-teal)", icon: "home" },
  { color: "var(--ios-red)", icon: "favorite" },
  { color: "var(--ios-yellow)", icon: "star" },
];

/**
 * Words that obviously name what a goal is for pick the matching glyph, in
 * either interface language and from the seed slugs (goalHoliday,
 * goalBuffer). Checked in order; the first hit wins.
 */
const KEYWORDS: readonly (readonly [RegExp, number])[] = [
  [/holiday|vacation|beach|отпуск|море|отдых/u, 0],
  [/buffer|reserve|emergency|cushion|safety|резерв|подушк|запас/u, 1],
  [/japan|trip|festival|япони|поездк|путешеств/u, 2],
  [/flight|plane|перел[её]т|билет/u, 4],
  [/home|house|flat|apartment|дом|квартир|ремонт/u, 5],
  [/wedding|gift|свадьб|подар/u, 6],
];

/** djb2 over the id: stable across renames and list re-ordering. */
function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function goalLook(goal: {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
}): GoalLook {
  const text = `${goal.slug ?? ""} ${goal.name}`.toLowerCase();
  const hit = KEYWORDS.find(([pattern]) => pattern.test(text));
  const index = hit !== undefined ? hit[1] : hash(goal.id) % ROTATION.length;
  return ROTATION[index] ?? { color: "var(--ios-tint)", icon: "savings" };
}
