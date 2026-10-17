"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import type { SymbolName } from "@/lib/symbols"
import { Symbol } from "@/components/ios/symbol"

/** The leading glyph of an iOS banner: a filled symbol in a tinted circle. */
function BannerIcon({
  name,
  tone,
  spin = false,
}: {
  readonly name: SymbolName
  readonly tone: string
  readonly spin?: boolean
}) {
  return (
    <span className="ios-banner-icon" style={{ background: tone }}>
      <Symbol name={name} size={20} filled weight={600} {...(spin ? { className: "animate-spin" } : {})} />
    </span>
  )
}

/**
 * Toasts drawn as iOS notification banners: Liquid Glass, full width with
 * the sheets' 8pt margins, a tinted symbol leading, a bold title over grey
 * text (app/globals.css styles the rest).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme === "light" || theme === "dark" ? theme : "system"}
      className="toaster group"
      /*
        Just below the top edge; in a standalone launch with the opaque status
        bar the page already starts under the clock, and in a browser tab the
        inset is 0, so the same numbers work in both.
      */
      offset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top) + 8px)",
        left: "8px",
        right: "8px",
      }}
      icons={{
        success: <BannerIcon name="check" tone="var(--ios-green)" />,
        info: <BannerIcon name="info" tone="var(--ios-tint)" />,
        warning: <BannerIcon name="warning" tone="var(--ios-orange)" />,
        error: <BannerIcon name="close" tone="var(--ios-red)" />,
        loading: <BannerIcon name="sync" tone="var(--ios-tint)" spin />,
      }}
      style={
        {
          "--normal-bg": "var(--glass-tint-strong)",
          "--normal-text": "var(--ios-label)",
          "--normal-border": "transparent",
          "--border-radius": "26px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
