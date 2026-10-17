"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isLocale } from "@/lib/locale";

/**
 * Switch the interface language.
 *
 * A plain server action rather than a safe-action: it touches no household
 * data, so there is nothing to authorise or validate beyond the locale itself
 * being one we ship.
 */
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // Every rendered string depends on this, so the whole tree is stale.
  revalidatePath("/", "layout");
}
