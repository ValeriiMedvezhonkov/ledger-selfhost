import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

const SITE = "https://ledger.example.com/api/session/refresh";

/** Where the browser actually lands: resolved the way the route resolves it. */
function landing(raw: string | null): URL {
  return new URL(safeNext(raw), SITE);
}

describe("safeNext", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeNext("/transactions?month=2026-10#top")).toBe(
      "/transactions?month=2026-10#top",
    );
  });

  it("falls back to the home page when there is no next", () => {
    expect(safeNext(null)).toBe("/");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    // Browsers read a backslash as a slash, so "/\" is protocol-relative too.
    "/\\evil.example",
    "/\\\\evil.example/login",
    // Tabs and newlines are stripped while parsing, closing up "/\t/".
    "/\t/evil.example",
    "/\n/evil.example",
    // Dot segments collapse into "//" during parsing, after any prefix check.
    "/.//evil.example",
    "/..//evil.example",
    "/x/..//evil.example",
    "/%2e//evil.example",
    "relative/path",
  ])("never leaves the site for %j", (raw) => {
    expect(landing(raw).origin).toBe("https://ledger.example.com");
  });

  it("falls back instead of throwing when parsing leaves no host", () => {
    // Collapses to "///", which is not a URL at all once resolved again.
    expect(safeNext("/.///")).toBe("/");
  });
});
