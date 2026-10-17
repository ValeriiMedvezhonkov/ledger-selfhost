import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { LOCALES } from "@/lib/locale";

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const enKeys = flatten(en);
const ruKeys = flatten(ru);

/**
 * The argument names an ICU message takes.
 *
 * Brace-aware rather than a regex: in `{count, plural, one {account} other
 * {accounts}}` the branch bodies are *not* arguments. A regex counts them, and
 * then reports a false mismatch the moment a translation writes its branches in
 * Cyrillic.
 */
function placeholders(value: string): Set<string> {
  const found = new Set<string>();
  let i = 0;

  while (i < value.length) {
    if (value[i] !== "{") {
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < value.length && /\s/.test(value[j] ?? "")) j += 1;

    let name = "";
    while (j < value.length && /[a-zA-Z0-9_]/.test(value[j] ?? "")) {
      name += value[j] ?? "";
      j += 1;
    }
    while (j < value.length && /\s/.test(value[j] ?? "")) j += 1;

    if (name !== "" && (value[j] === "}" || value[j] === ",")) found.add(name);

    // Skip the whole construct, branch bodies included.
    let depth = 0;
    while (i < value.length) {
      if (value[i] === "{") depth += 1;
      else if (value[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
  }

  return found;
}

describe("message catalogues", () => {
  it("ships one file per locale", () => {
    expect([...LOCALES].sort()).toEqual(["en", "ru"]);
  });

  it("has a non-trivial number of keys", () => {
    expect(enKeys.size).toBeGreaterThan(200);
  });

  it("defines exactly the same keys in every locale", () => {
    const missingInRu = [...enKeys.keys()].filter((key) => !ruKeys.has(key));
    const extraInRu = [...ruKeys.keys()].filter((key) => !enKeys.has(key));

    expect(missingInRu, "keys missing from ru.json").toEqual([]);
    expect(extraInRu, "keys in ru.json with no English original").toEqual([]);
  });

  it("uses the same placeholders on both sides of every key", () => {
    // A translation that drops {amount} renders a sentence with a hole in it,
    // and nothing else in the stack would catch that.
    const mismatched: string[] = [];

    for (const [key, english] of enKeys) {
      const russian = ruKeys.get(key);
      if (russian === undefined) continue;

      const a = [...placeholders(english)].sort();
      const b = [...placeholders(russian)].sort();
      if (a.join(",") !== b.join(",")) {
        mismatched.push(key + ": en[" + a.join(",") + "] vs ru[" + b.join(",") + "]");
      }
    }

    expect(mismatched).toEqual([]);
  });

  it("has no empty translations", () => {
    const empty = [...ruKeys].filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("actually translates — ru is not just a copy of en", () => {
    const identical = [...enKeys].filter(([key, value]) => {
      const russian = ruKeys.get(key);
      // Brand names, placeholders and numeric formats legitimately match.
      return russian === value && !/^[\d\W]+$|Ledger|Lidl|CSV|JSON|AUTH_/.test(value);
    });

    // A handful of coincidences are fine; wholesale duplication is not.
    expect(identical.length).toBeLessThan(10);
  });
});
