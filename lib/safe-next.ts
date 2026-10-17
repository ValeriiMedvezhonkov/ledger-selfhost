/**
 * Where to send someone after a redirect-style route, from an untrusted
 * `?next=` value.
 *
 * `next` is confined to a path on this site. Accepting a full URL here would
 * turn renewal into an open redirect, and one that hands over a fresh session
 * on the way out.
 *
 * Checking the string's first characters is not enough: browsers read "\" as
 * "/" and drop tabs and newlines while parsing, so "/\evil.com" and
 * "/<tab>/evil.com" both come out protocol-relative. The value is resolved the
 * way the browser will resolve it, against a placeholder origin, and only its
 * path survives — and only if it never left that origin.
 */
const PLACEHOLDER = "http://next.invalid";

function hasUnsafeCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The value resolved against the placeholder, or null if it leaves it. */
function onSite(value: string): URL | null {
  try {
    const url = new URL(value, PLACEHOLDER);
    return url.origin === PLACEHOLDER ? url : null;
  } catch {
    return null;
  }
}

export function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith("/") || hasUnsafeCharacter(raw)) {
    return "/";
  }

  const url = onSite(raw);
  if (url === null) return "/";

  // Parsing can itself produce a protocol-relative path: dot segments
  // collapse "/.//evil.com" into "//evil.com". So the result is checked the
  // way the caller will use it, by resolving it once more.
  const path = url.pathname + url.search + url.hash;
  return onSite(path) === null ? "/" : path;
}
