/**
 * Shared locale constants.
 *
 * Deliberately free of `server-only` and `next/headers` so client components,
 * the message-catalogue test and the server request config can all import it.
 * The cookie read lives in `lib/locale-server.ts`.
 */

/** The languages the interface is available in. */
export const LOCALES = ["en", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself — nobody looks for "Russian" in a Russian UI. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  ru: "Русский",
};

export const LOCALE_COOKIE = "ledger-locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return (
    value !== undefined &&
    value !== null &&
    (LOCALES as readonly string[]).includes(value)
  );
}
