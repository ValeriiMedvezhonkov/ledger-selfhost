import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/lib/locale";

/**
 * The active language.
 *
 * Held in a cookie rather than the URL. This is a two-person app: nobody shares
 * links, so a `/ru/...` prefix on every route would be pure overhead for the
 * one thing it buys — a locale you can link to.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return isLocale(store.get(LOCALE_COOKIE)?.value) 
    ? (store.get(LOCALE_COOKIE)?.value as Locale)
    : DEFAULT_LOCALE;
}
