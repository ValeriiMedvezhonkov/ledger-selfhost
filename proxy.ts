import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECURE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-config";

/**
 * Next 16 renamed middleware to proxy. This is an *optimistic* redirect for
 * unauthenticated visitors — it only looks for the presence of a session
 * cookie, never validates it. Authorization happens in `requireUser()` and in
 * every Server Action, which is where it belongs.
 */
const PUBLIC_PATHS = ["/login", "/denied"];

/** Both spellings: the __Secure- prefix is only used over HTTPS. */
const SESSION_COOKIES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;



export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const cookieName = SESSION_COOKIES.find((name) => request.cookies.has(name));

  if (cookieName === undefined) {
    /*
     * No session, but this browser may hold a refresh token. Send it to renew
     * rather than to the login page: the round trip is invisible, and the
     * endpoint falls back to /login itself if the token is dead.
     */
    const hasRefresh =
      request.cookies.has(REFRESH_COOKIE) ||
      request.cookies.has(REFRESH_COOKIE_SECURE);

    if (hasRefresh) {
      const renew = new URL("/api/session/refresh", request.url);
      renew.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(renew);
    }

    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  /*
   * The path travels as a header because a Server Component cannot read the
   * request URL. requireUser needs it to send somebody back where they were
   * after a silent renewal.
   */
  const forwarded = new Headers(request.headers);
  forwarded.set("x-ledger-path", pathname + request.nextUrl.search);

  const response = NextResponse.next({ request: { headers: forwarded } });
  const token = request.cookies.get(cookieName)?.value;

  /*
   * Slide the cookie forward on every request.
   *
   * Auth.js already rolls the session row — its expiry moves back to the full
   * maxAge as the session is used — but it does not re-send the cookie, and the
   * cookie was written with a fixed lifetime when the code was exchanged. Left
   * alone, the browser would drop it exactly thirty days after signing in even
   * for somebody using the app daily, and they would be bounced to the login
   * page while a perfectly valid session sat in the database.
   *
   * This only changes how long the browser keeps the token. Whether the token
   * still works is decided by the session row, which is unchanged and still
   * expires after real inactivity.
   */
  if (token !== undefined) {
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieName.startsWith("__Secure-"),
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  return response;
}

export const config = {
  // The manifest is fetched without credentials, so redirecting it to /login
  // made it unparseable; fonts are public static assets like the icons.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)"],
};
