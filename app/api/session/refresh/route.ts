import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { redeemRefreshToken } from "@/lib/refresh-tokens";
import { recordAttempt } from "@/lib/auth-attempts";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import { safeNext } from "@/lib/safe-next";
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECURE,
  REFRESH_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-config";


/**
 * Silent renewal.
 *
 * A route handler rather than something inside `requireUser`, because only
 * handlers, actions and the proxy may set cookies — and renewal is precisely
 * the act of replacing two of them. The user sees a redirect they never notice;
 * nothing is asked of them.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secure = await secureCookiesEnabled();
  const cookieName = secure ? REFRESH_COOKIE_SECURE : REFRESH_COOKIE;
  const target = safeNext(request.nextUrl.searchParams.get("next"));

  const token = request.cookies.get(cookieName)?.value;
  if (token === undefined) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const result = await redeemRefreshToken(token);

  if (!result.ok) {
    await recordAttempt({
      email: null,
      stage: "refresh",
      outcome: result.reason === "reused" ? "locked" : "failure",
    });

    // Clear the dead cookie, or every subsequent request bounces through here.
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(cookieName);
    return response;
  }

  await recordAttempt({
    email: null,
    userId: result.userId,
    stage: "refresh",
    outcome: "success",
  });

  const response = NextResponse.redirect(new URL(target, request.url));

  response.cookies.set(
    secure ? "__Secure-authjs.session-token" : "authjs.session-token",
    result.sessionToken,
    {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );

  response.cookies.set(cookieName, result.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });

  return response;
}
