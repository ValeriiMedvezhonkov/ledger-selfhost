import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getLocale } from "@/lib/locale-server";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Splash } from "@/components/splash";
import { NoZoom } from "@/components/no-zoom";
import { TapGuard } from "@/components/ios/tap-guard";
import { NoLinkDrag } from "@/components/ios/no-link-drag";
import { ThemeColorScript, ThemeColorSync } from "@/components/theme-color";
import "./globals.css";

/*
 * SF Pro is the face the iOS27 boards stand in for, and on Apple devices the
 * system stack in app/ios.css reaches it directly. Inter is only the fallback
 * for everything else — it is what the boards are drawn in, so a desktop
 * Chrome on Windows still sees the intended proportions.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

/*
 * Every screen reads cookies before it renders (the locale here, the session
 * in app/(app)/layout.tsx), so none can be prerendered into an instant shell.
 * Variant B uses Cache Components for kept-alive screens (<Activity>), not for
 * shells: screens render on request exactly as before, and a loading shell is
 * deliberately not drawn (the owner chose no placeholders).
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");

  return {
    title: {
      default: t("name"),
      template: `%s · ${t("name")}`,
    },
    description: t("description"),
    robots: { index: false, follow: false },
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // An installed app does not zoom; see components/no-zoom.tsx for pinch.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const t = await getTranslations("app");

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      /*
       * Spelled out although it is the browser default: when no
       * <ViewTransition> boundary takes part in a navigation, React hides
       * the root snapshot (sets view-transition-name: none here and fades
       * ::view-transition-group(root) to 0) unless this inline name is
       * already set. The push slide animates exactly that root snapshot
       * (app/ios.css), so without this every push just appeared.
       */
      style={{ viewTransitionName: "root" }}
    >
      <head>
        {/*
         * The two tags iOS reads live for the installed app's status bar,
         * rendered here rather than through `metadata`/`viewport`: Next.js
         * re-creates its metadata tags on every navigation (removes them all,
         * then adds them back), and iOS reacts to the moment they are gone —
         * the native bar fell back to its translucent default and animated
         * back, a half-second blur over the clock on every screen switch.
         * The root layout never remounts, so these nodes stay put.
         * theme-color is corrected per theme and surface before first paint
         * and kept in step by components/theme-color.tsx.
         */}
        <meta name="theme-color" content="#f2f2f7" />
        {/*
         * "default", not "black-translucent". Translucent lets the page run
         * under the clock, but iOS 26+ then lays its own Liquid Glass edge
         * blur over the top ~110px of the page — system chrome drawn above the
         * web view, so nothing of ours can sit on top of it (no z-index, fixed
         * strip or meta tag; a fixed strip only changes the blur's colour).
         * Tried again on 2026-10-03 at the owner's request: on iOS 27 the
         * toolbar's glass buttons were blurred, and moving the header below
         * the band was ruled out. With an opaque bar the page starts below it
         * and nothing of ours is in that band; the bar is painted from
         * theme-color (components/theme-color.tsx), the screen's own
         * background, so the top still reads as one surface. It also avoids
         * iOS 26's short-viewport launch bug, WebKit 301108.
         *
         * The cost: iOS may only re-read theme-color at launch, so after
         * switching the in-app theme the bar can lag until the app is reopened.
         */}
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/*
         * The rest of the home-screen app setup, here too: `metadata.appleWebApp`
         * would make Next.js emit its own status-bar-style tag again (and
         * re-create it on every navigation).
         */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={t("name")} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeColorScript />
        <NoZoom />
        <TapGuard />
        <NoLinkDrag />
        <Splash />
        <NextIntlClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ThemeColorSync />
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <Toaster position="top-center" duration={4000} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
