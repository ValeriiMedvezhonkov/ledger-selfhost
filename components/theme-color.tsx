"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

/** The app's ground — matches --ios-bg. */
const LIGHT = "#f2f2f7";
const DARK = "#000000";
/** The aurora's base tone — matches --aurora-bg in app/ios.css. */
const AURORA_LIGHT = "#e2dbf5";
const AURORA_DARK = "#0e0b17";

/** Routes drawn over the aurora rather than the plain ground. */
const AURORA_ROUTES = ["/login", "/verify"];

/**
 * Keeps the strip behind the status bar the colour of what is under it.
 *
 * Safari paints that strip — the notch area — from the `theme-color` meta,
 * not from the page. Two things decide the right colour:
 *
 * - the app's resolved theme, which can disagree with the OS (phone in light
 *   mode, app switched to dark), so the meta must not keep its OS-keyed media
 *   split;
 * - the surface: the aurora screens (sign-in, verify, the Face ID lock) fade
 *   their top edge into the aurora's base tone, so the strip takes that tone
 *   and the gradient runs on under the notch with no seam.
 */
function applyThemeColor(dark: boolean, aurora: boolean): void {
  const color = aurora ? (dark ? AURORA_DARK : AURORA_LIGHT) : dark ? DARK : LIGHT;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.appendChild(meta);
    return;
  }
  // Only real changes: iOS re-reads the tag on any write, and this runs on
  // every DOM change.
  for (const meta of metas) {
    if (meta.hasAttribute("media")) meta.removeAttribute("media");
    if (meta.getAttribute("content") !== color) meta.setAttribute("content", color);
  }
}

/** Follows the in-app theme, the route, and the lock screen coming and going. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();

  useEffect(() => {
    if (resolvedTheme === undefined) return;
    const dark = resolvedTheme === "dark";
    const update = () => {
      applyThemeColor(dark, document.querySelector(".aurora-root") !== null);
    };
    update();
    // The lock screen mounts over any route, so watch for it directly.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [resolvedTheme, pathname]);

  return null;
}

/**
 * The pre-hydration half: corrects the meta before first paint using the same
 * localStorage key next-themes reads (and the route, for the aurora screens),
 * so a launch never flashes the wrong strip while React loads.
 */
export function ThemeColorScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function () {
  var stored = null;
  try { stored = localStorage.getItem("theme"); } catch (e) {}
  var dark = stored === "dark" ||
    (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var aurora = ${JSON.stringify(AURORA_ROUTES)}.some(function (route) {
    return location.pathname === route || location.pathname.indexOf(route + "/") === 0;
  });
  var color = aurora ? (dark ? "${AURORA_DARK}" : "${AURORA_LIGHT}") : (dark ? "${DARK}" : "${LIGHT}");
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    metas[i].removeAttribute("media");
    metas[i].setAttribute("content", color);
  }
})();`,
      }}
    />
  );
}
