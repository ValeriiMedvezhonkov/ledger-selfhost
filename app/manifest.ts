import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledger",
    short_name: "Ledger",
    description: "Household finance for two",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f2f7",
    theme_color: "#f2f2f7",
    /*
     * The Receipt icon (finance-tracker.pen, "App Icon · J Receipt"). Square
     * and opaque: iOS (app/apple-icon.png) and Android mask it themselves,
     * so the same art is also safe as "maskable".
     */
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
