import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Hosts the dev server will serve to besides localhost.
   *
   * Next blocks cross-origin access to dev resources by default, which is right
   * — otherwise any page you visit could reach into your dev server. It also
   * means opening the app from a phone on the same network silently fails: the
   * page renders, and then Server Actions do not run, so a sign-in looks like a
   * wrong password rather than a blocked request.
   *
   * Set DEV_ORIGINS in .env to whatever address the machine has on the LAN;
   * this is development-only and is ignored in a production build.
   */
  allowedDevOrigins: [
    ...(process.env.DEV_ORIGINS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
    /*
     * Any private-LAN address, so a phone on whatever Wi-Fi the laptop is on
     * today — home, office — works without editing .env or restarting.
     * Next matches these per dot-separated segment. Development only, and
     * only RFC 1918 ranges: nothing reachable from the internet.
     */
    "192.168.*.*",
    "10.*.*.*",
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  ],

  // The floating dev badge sits exactly where the mobile tab bar is, covering
  // the first tab while developing. Nothing is lost by turning it off.
  devIndicators: false,
  poweredByHeader: false,
  /*
   * Visited pages come back instantly from the client router cache instead of
   * re-running every query on each tab switch. Next 15 dropped the dynamic
   * default from 30s to 0 — this restores felt-instant navigation.
   *
   * Five minutes is safe here because every mutation in the app goes through
   * a server action that calls revalidatePath, which purges this cache — so
   * your own edits are always fresh. The only staleness window is the other
   * person's edits from their device, and pull-to-refresh covers that.
   */
  /*
   * Cache Components (variant B). Its point here is navigation with React
   * <Activity>: a screen you leave is hidden, not destroyed, so coming back
   * shows it exactly as it was — scroll, filters, charts, drafts — without a
   * rebuild, the way a native tab bar keeps its tabs. Next.js keeps the few
   * most recent screens this way. Data is still read per request (nothing
   * is `use cache`d); the app area opts out of instant-shell validation
   * (`instant = false` in app/(app)/layout.tsx), so screens load as before.
   */
  cacheComponents: true,
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
  /*
   * Standalone output only when building the container image, which sets
   * BUILD_STANDALONE. It emits a self-contained server carrying just the
   * packages actually imported, which is what keeps that image small — and it
   * is meaningless on a host that builds and runs the app its own way, so
   * Vercel gets an ordinary build.
   */
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
