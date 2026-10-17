import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

/**
 * Named without a `use` prefix on purpose: that prefix marks a React hook,
 * and the lint rules quite reasonably refuse to see one called from a plain
 * function.
 *
 * Whether cookies should carry the `__Secure-` prefix and the Secure flag.
 *
 * This has to match what Auth.js decides, or the two write and read different
 * cookie names and a correct password produces a session nobody can find.
 *
 * Auth.js keys the decision on whether the URL is HTTPS — not on NODE_ENV,
 * which is what this used to do. The two agree in a normal deployment and
 * disagree in exactly the setups worth testing in: a production build served
 * over plain HTTP, or one behind a proxy that terminates TLS.
 *
 * `x-forwarded-proto` covers the second case, where the app itself is spoken to
 * over HTTP while the browser is on HTTPS — the shape every reverse proxy
 * produces, including the Caddy in compose.yaml.
 */
export async function secureCookiesEnabled(): Promise<boolean> {
  if (env.AUTH_URL !== undefined) return env.AUTH_URL.startsWith("https://");

  const list = await headers();
  const forwarded = list.get("x-forwarded-proto");
  if (forwarded !== null) return forwarded.split(",")[0]?.trim() === "https";

  return false;
}

/** The session cookie's name under the scheme currently in use. */
export async function sessionCookieName(): Promise<string> {
  return (await secureCookiesEnabled())
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}
