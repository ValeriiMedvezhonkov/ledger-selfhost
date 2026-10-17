import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";

/**
 * Guards keys that only exist as strings in code.
 *
 * The catalogue test next door compares en against ru, which cannot see a key
 * that is missing from *both* — exactly what happened when the `errors`
 * namespace was overwritten rather than merged, and the not-found page started
 * throwing at render. These read the keys back out of the source instead.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const sources = [...walk("app"), ...walk("lib"), ...walk("components")].map(
  (path) => readFileSync(path, "utf8"),
);

function keysFrom(pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
}

describe("keys referenced from code exist in every catalogue", () => {
  it("resolves every ActionError key", () => {
    const keys = keysFrom(/new ActionError\("([A-Za-z0-9_]+)"\)/g);
    // A sanity floor: if the regex ever stops matching, the test must fail
    // loudly rather than silently pass over an empty list.
    expect(keys.length).toBeGreaterThan(20);

    const missingEn = keys.filter((key) => !(key in en.errors));
    const missingRu = keys.filter((key) => !(key in ru.errors));

    expect(missingEn, "ActionError keys missing from en.json").toEqual([]);
    expect(missingRu, "ActionError keys missing from ru.json").toEqual([]);
  });

  it("resolves every slug the seed stamps onto its rows", () => {
    // Read as text rather than imported: db/seed.ts reads DATABASE_URL at module
    // scope and would refuse to load here. A slug with no message renders the
    // stored Slovak or English original instead — silently, in both languages.
    const seed = readFileSync("db/seed.ts", "utf8");
    const table = /const SEEDED_SLUGS[\s\S]*?\n\]\);/.exec(seed)?.[0] ?? "";
    const slugs = [...table.matchAll(/,\s*"([A-Za-z0-9_]+)"\]/g)]
      .map((match) => match[1])
      .filter((slug): slug is string => slug !== undefined);

    expect(slugs.length).toBeGreaterThan(25);

    const seededEn: Record<string, string> = en.seeded;
    const seededRu: Record<string, string> = ru.seeded;

    expect(slugs.filter((slug) => !(slug in seededEn))).toEqual([]);
    expect(slugs.filter((slug) => !(slug in seededRu))).toEqual([]);
  });

  it("keeps the page-level error messages the error and not-found pages need", () => {
    // These are read by app/error.tsx and app/not-found.tsx, which only render
    // when something has already gone wrong — the worst place to discover a
    // missing message.
    const required = [
      "pageTitle",
      "pageBody",
      "tryAgain",
      "notFoundTitle",
      "notFoundBody",
      "backToDashboard",
    ];

    expect(required.filter((key) => !(key in en.errors))).toEqual([]);
    expect(required.filter((key) => !(key in ru.errors))).toEqual([]);
  });
});
