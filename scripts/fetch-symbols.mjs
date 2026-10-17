// Downloads a subset of Material Symbols Rounded (variable: FILL, wght, opsz)
// containing only the glyphs the app draws. Re-run after adding an icon name
// to lib/symbols.ts:  node scripts/fetch-symbols.mjs — then bump the ?v= on
// the @font-face URL in app/ios.css so installed PWAs drop the cached file.
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/symbols.ts", import.meta.url), "utf8");
const names = [...new Set([...source.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]))].sort();
const url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,0&icon_names=" +
  names.join(",") +
  "&display=block";
const css = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" } })).text();
const font = css.match(/url\((https:[^)]+)\)/)?.[1];
if (!font) throw new Error("No font URL in response:\n" + css);
const buf = Buffer.from(await (await fetch(font)).arrayBuffer());
writeFileSync(new URL("../public/fonts/material-symbols-rounded.woff2", import.meta.url), buf);
console.log(`${names.length} symbols, ${(buf.length / 1024).toFixed(1)} KB`);
