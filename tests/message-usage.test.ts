import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";

/**
 * Every message key the code asks for must exist.
 *
 * The catalogue test next door compares the two locales against each other,
 * which cannot see a key missing from *both* — and that is the failure that
 * keeps happening, because bulk edits remove keys from both files at once. The
 * result is an exception at render time on whichever page uses it, found by
 * loading that page rather than by running the tests.
 *
 * This reads the keys back out of the source instead.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

interface Usage {
  readonly file: string;
  readonly key: string;
}

/**
 * Finds `const t = useTranslations("ns")` and then every `t("key")` bound to
 * it, so files holding several translators — `t`, `tc`, `tt` — resolve each
 * against its own namespace.
 */
function usagesIn(file: string): Usage[] {
  const source = readFileSync(file, "utf8");
  const found: Usage[] = [];

  const binders = [
    ...source.matchAll(
      /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g,
    ),
  ];

  for (const [, variable, namespace] of binders) {
    if (variable === undefined || namespace === undefined) continue;

    // Only literal keys can be checked; `t(item.labelKey)` is resolved at
    // runtime and is deliberately skipped rather than guessed at.
    const calls = source.matchAll(
      new RegExp(String.raw`\b${variable}\(\s*"([A-Za-z0-9_.]+)"`, "g"),
    );

    for (const [, key] of calls) {
      if (key !== undefined) found.push({ file, key: `${namespace}.${key}` });
    }
  }

  return found;
}

function resolve(catalogue: unknown, path: string): boolean {
  let node: unknown = catalogue;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

const usages = [...walk("app"), ...walk("components")].flatMap(usagesIn);

describe("messages referenced from code", () => {
  it("finds a meaningful number of usages", () => {
    // Guards the regex itself: if it stops matching, the checks below would
    // pass over an empty list and prove nothing.
    expect(usages.length).toBeGreaterThan(100);
  });

  it("resolves every key in both locales", () => {
    const missingEn = usages
      .filter((usage) => !resolve(en, usage.key))
      .map((usage) => `${usage.key}  (${usage.file})`);
    const missingRu = usages
      .filter((usage) => !resolve(ru, usage.key))
      .map((usage) => `${usage.key}  (${usage.file})`);

    expect([...new Set(missingEn)], "missing from en.json").toEqual([]);
    expect([...new Set(missingRu)], "missing from ru.json").toEqual([]);
  });
});
