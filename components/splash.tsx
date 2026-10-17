import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

interface SplashMember {
  readonly name: string;
  readonly emoji: string | null;
}

/**
 * Who is greeted at launch: both members of the signed-in user's household,
 * each with the avatar emoji edited on Семья (migration 0010 moved them out
 * of a map that used to be hard-coded here). Signed out, nobody.
 */
async function splashMembers(): Promise<SplashMember[]> {
  const session = await auth();
  const householdId = session?.user.householdId ?? null;
  if (householdId === null) return [];

  const rows = await db
    .select({
      name: users.displayName,
      fallback: users.name,
      email: users.email,
      emoji: users.avatarEmoji,
    })
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(asc(users.email));
  return rows.map((row) => ({
    name: row.name ?? row.fallback ?? row.email,
    emoji: row.emoji,
  }));
}

/** Everything goes into raw HTML, so text is escaped like any other. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The launch splash (boards L00 / D00): an aurora, the two of you as emoji in
 * glass bubbles with a € between, the wordmark, «… · семейная книга», and the
 * loading dots. Painted with the server HTML so it is on screen before a
 * single byte of JavaScript runs.
 *
 * Shown only for home-screen (standalone) launches and only once per browser
 * session — a splash replaying on every in-app navigation is a loading screen
 * pretending to be branding. The inline script decides synchronously, before
 * first paint, so browser-tab visitors never see even a flash of it.
 *
 * Everything lives inside one dangerouslySetInnerHTML wrapper, and the
 * script NEVER mutates the wrapper's contents — React hydrates it by
 * comparing innerHTML, and even toggling `hidden` pre-paint reads as a
 * mismatch (a real bug, seen on the iPhone as a hydration error on standalone
 * launches). Show/fade both run through classes on <html>, which carries
 * suppressHydrationWarning already.
 */
export async function Splash() {
  let members: SplashMember[] = [];
  try {
    members = await splashMembers();
  } catch {
    // An unreadable session or database means a signed-out splash, never a
    // broken page.
  }
  const t = await getTranslations("ios.splash");

  const withEmoji = members.filter((member) => member.emoji !== null);
  const duo =
    withEmoji.length > 0
      ? `<span class="duo">${withEmoji
          .slice(0, 2)
          .map((member) => `<span class="bubble">${escapeHtml(member.emoji ?? "")}</span>`)
          .join("")}${withEmoji.length > 1 ? `<span class="euro">€</span>` : ""}</span>`
      : "";
  const tagline =
    members.length >= 2
      ? t("couple", { a: members[0]?.name ?? "", b: members[1]?.name ?? "" })
      : t("tagline");

  const html = `
<div id="splash">
  <span class="aurora" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
  <span class="face">
    ${duo}
    <span class="word">Ledger</span>
    <span class="tag">${escapeHtml(tagline)}</span>
  </span>
  <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
</div>
<script>(function () {
  var root = document.documentElement;
  var standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  var seen = false;
  try { seen = sessionStorage.getItem("ledger-splashed") === "1"; } catch (e) {}
  if (!standalone || seen) return;
  try { sessionStorage.setItem("ledger-splashed", "1"); } catch (e) {}
  root.classList.add("splashing");
  var done = false;
  function out() {
    if (done) return;
    done = true;
    root.classList.add("splash-out");
    // Back to display:none once faded; the node itself is never touched.
    setTimeout(function () { root.classList.remove("splashing", "splash-out"); }, 400);
  }
  if (document.readyState === "complete") setTimeout(out, 450);
  else window.addEventListener("load", function () { setTimeout(out, 450); });
  // Never trap the user behind a splash if "load" stalls on a slow network.
  setTimeout(out, 4000);
})();</script>
`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
