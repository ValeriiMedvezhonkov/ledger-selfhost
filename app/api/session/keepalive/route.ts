import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { issueRefreshToken, redeemRefreshToken } from "@/lib/refresh-tokens";
import { twoFactorState } from "@/lib/two-factor";
import { recordAttempt } from "@/lib/auth-attempts";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECURE,
  REFRESH_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-config";


export type KeepaliveStatus = "active" | "renewed" | "signed-out";

/**
 * Keeps an open page's session alive without navigating.
 *
 * The redirect flow next door only runs when something asks for a page, which
 * is no help to a tab left open overnight — the session lapses in place, and
 * the next click is a Server Action that fails rather than a navigation that
 * could renew. This is the same exchange, in JSON, callable from the page.
 *
 * Reading the user is not a side-effect-free check: it resolves the session,
 * which pushes its expiry forward. So a page that keeps calling this keeps its
 * session current, and renewal is only reached once the session has genuinely
 * lapsed.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secure = await secureCookiesEnabled();
  const cookieName = secure ? REFRESH_COOKIE_SECURE : REFRESH_COOKIE;
  const token = request.cookies.get(cookieName)?.value;

  const user = await getCurrentUser();
  if (user) {
    const response = NextResponse.json({
      status: "active" satisfies KeepaliveStatus,
    });

    /*
     * Issue the renewal credential here if the browser has none.
     *
     * Sign-in goes through Auth.js, whose callbacks cannot set cookies, so
     * there is no point during sign-in where this could be handed out. Doing it
     * on the first keepalive of an authenticated session covers every way in,
     * present or future, instead of each one having to remember.
     */
    if (token === undefined) {
      const factor = await twoFactorState(user.id);
      const fresh = await issueRefreshToken({
        userId: user.id,
        // Only as much as the session has actually earned.
        totpVerified: factor.enabled ? factor.verified : false,
      });

      response.cookies.set(cookieName, fresh, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: REFRESH_MAX_AGE_SECONDS,
      });
    }

    return response;
  }

  if (token === undefined) {
    return NextResponse.json({ status: "signed-out" satisfies KeepaliveStatus });
  }

  const result = await redeemRefreshToken(token);

  if (!result.ok) {
    await recordAttempt({
      email: null,
      stage: "refresh",
      outcome: result.reason === "reused" ? "locked" : "failure",
    });

    const response = NextResponse.json({
      status: "signed-out" satisfies KeepaliveStatus,
    });
    response.cookies.delete(cookieName);
    return response;
  }

  await recordAttempt({
    email: null,
    userId: result.userId,
    stage: "refresh",
    outcome: "success",
  });

  const response = NextResponse.json({
    status: "renewed" satisfies KeepaliveStatus,
  });

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
