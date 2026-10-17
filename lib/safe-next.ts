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

export function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith("/") || hasUnsafeCharacter(raw)) {
    return "/";
  }

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER);
  } catch {
    return "/";
  }

  if (url.origin !== PLACEHOLDER) return "/";
  return url.pathname + url.search + url.hash;
}
