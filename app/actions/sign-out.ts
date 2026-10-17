"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { secureCookiesEnabled } from "@/lib/cookie-scope";
import { revokeToken } from "@/lib/refresh-tokens";
import { REFRESH_COOKIE, REFRESH_COOKIE_SECURE } from "@/lib/session-config";
import { signOut } from "@/auth";

/**
 * Sign out, everywhere it is offered — the desktop user menu and the Выйти
 * row in Settings. Lived inline in the layout until Settings needed it too.
 *
 * The renewal credential has to go too, and first. Ending the session while
 * leaving it in place would mean the very next request silently signed the
 * user straight back in — a sign-out button that does nothing.
 */
export async function signOutUser(): Promise<void> {
  const jar = await cookies();
  const cookieName = (await secureCookiesEnabled())
    ? REFRESH_COOKIE_SECURE
    : REFRESH_COOKIE;
  const refresh = jar.get(cookieName)?.value;
  if (refresh !== undefined) await revokeToken(refresh);
  jar.delete(cookieName);

  await signOut({ redirect: false });
  redirect("/login");
}
