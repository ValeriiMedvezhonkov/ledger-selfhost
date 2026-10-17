# Decisions & deviations

What the build does differently from the original brief, and why. Every item
here was a forced choice, not a preference.

---

## Deviations from the brief

### TypeScript 6.0.3, not "latest"

npm `latest` is **TypeScript 7.0.2**, but `typescript-eslint@8.67` declares
`typescript >=4.8.4 <6.1.0`. On TS 7 the type-checked lint rules — the ones that
actually enforce "no `any`, no unsafe escape hatches" — do not run.

TS 6.0.3 is the newest release inside the supported range, so it keeps the strict
ruleset working. Revisit when typescript-eslint ships TS 7 support.

### `node-postgres`, not `@neondatabase/serverless`

The brief specified Neon's serverless driver. `db/index.ts` uses `pg` instead:
it speaks to Neon's pooled endpoint and to a local Postgres with one code path
and one connection type, rather than a union of two driver types that would leak
into every query's inferred types.

Neon's driver is worth switching to if this ever runs on the edge runtime. On
Node — which is what Vercel uses here — `pg` against the pooler is a supported,
ordinary setup.

### `proxy.ts`, not `middleware.ts`

Next 16 renamed Middleware to Proxy. The file exports `proxy` instead of
`middleware`; behaviour is unchanged. Next's own docs state it is not intended
for session management, which matches the design here: it does an optimistic
cookie-presence redirect, and `requireUser()` plus every Server Action does the
real check.

### shadcn no longer ships a `form` component

`npx shadcn add form` resolves to an empty registry item in CLI 4.18 — it has
been superseded by `field`, which is presentational and has no react-hook-form
integration. `components/form-row.tsx` is the small typed bridge between
`Controller` and shadcn's `Field` primitives, wiring `aria-describedby` for
errors. It is application code and is held to the full strict ruleset.

### A dev-only password login

Credentials providers in Auth.js force the entire app onto JWT sessions, which
would have meant giving up database sessions. Instead `/api/dev-login` writes a
row into the same `session` table the Drizzle adapter reads, so there is exactly
one session strategy.

Two independent locks: `lib/env.ts` refuses to boot a production build with
`AUTH_DEV_LOGIN=true`, and the route returns 404 whenever `NODE_ENV=production`.
This was proven — the first production build attempt failed with exactly that
error before real credentials were supplied.

### Lint scope for generated code

`components/ui/**` and `hooks/use-mobile.ts` are vendored `shadcn add` output.
They keep the base Next rules but are exempt from the strict presets, otherwise
every `shadcn add` would break the build. **Application code has no exemption** —
that is what keeps "no `any`" meaningful.

Three generated files needed one-line fixes to satisfy `exactOptionalPropertyTypes`
(`sonner.tsx`, `dropdown-menu.tsx`, `calendar.tsx`). Re-running the CLI will
overwrite them; the fixes are mechanical (`?? false`, a conditional spread, a
narrowed ternary).

**`select.tsx` has a fourth, behavioural change.** The radix-nova output defaults
`SelectContent` to `position="item-aligned"` and `align="center"`, which is
Radix's mode that lays the *selected option on top of the trigger* and sizes the
panel to its content — so an open dropdown covered the field it belonged to and
jutted sideways. The defaults are now `position="popper"`, `align="start"`,
`sideOffset={4}`, plus `max-w-[calc(100vw-1.5rem)]` for the same portal-overflow
reason as the range picker. Callers can still pass `position="item-aligned"`
explicitly. **Re-running `shadcn add select` reverts this** — reapply the four
lines at the top of `SelectContent`.

### `lib/now.ts`

`no-restricted-syntax` bans `new Date()` inside server components so rendering
stays deterministic. Pages legitimately need today's date, so `serverNow()` is
the single sanctioned wall-clock read; everything downstream takes `now` as an
argument.

---

## Design decisions

### Money

Integer minor units in `bigint`, mapped through a Drizzle `customType` to a
branded `Minor` (`number & { readonly [minorBrand]: true }`). The brand means a
raw number cannot be passed where an amount is expected, so arithmetic outside
`lib/money.ts` does not typecheck.

FX rates are integers scaled by `1e9`. `convertToBase` multiplies via `BigInt`
so the intermediate product is exact, then rounds half away from zero.

**Two real bugs were caught by the tests, not by review:**

1. For 3-decimal currencies (KWD, BHD), the "three trailing digits means a
   thousands separator" heuristic misread `1.234` as 1234 whole units instead of
   1.234. Now the heuristic is skipped when the currency's exponent is 3.
2. Malformed input like `1.2.3.4` parsed as `123.4`, because every separator was
   stripped from the integer part unconditionally. Grouping is now validated
   against `^\d{1,3}([.,]\d{3})*$`.

`12.345` in a 2-decimal currency remains **1,234,500 minor** — it is genuinely
ambiguous, and for a currency with two decimals the grouped reading is the only
sensible one. This is asserted in the tests so nobody "fixes" it later.

### Zod schemas used by forms carry no transforms or defaults

`.transform()`, `.default()` and `.coerce` make a schema's input and output types
differ, and react-hook-form requires them identical — this surfaced three times
during the build. Form schemas are therefore plain; normalisation (empty note →
`null`) happens in the action instead.

### Chart colours are validated, not chosen

`lib/chart-palette.ts` holds an eight-slot categorical palette, a diverging pair
for income/expense, and one sequential hue. These were run through the data-viz
validator against this app's real surfaces (`#ffffff` light, `#171717` dark):

```
light — worst adjacent CVD ΔE 9.1, worst adjacent normal-vision ΔE 19.6
dark  — worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3
```

Both pass. Light mode flags three slots below 3:1 contrast, which triggers the
relief rule — so every chart ships a table view (the toggle in `ChartFrame`) and
the category donut is paired with a labelled ranked list. Colour is never the
only way to read a value.

The category colour picker offers exactly these eight, so user-chosen colours
stay inside the validated set. A ninth category folds into "Other" rather than
generating a new hue.

### Recurring transactions

`materializeRecurring` locks the rule row `FOR UPDATE` and advances
`next_run_on` inside the same database transaction as the insert, so the
dashboard and the daily cron can both call it safely. Verified: three dashboard
loads plus two cron runs left the row count unchanged.

A new rule dated in the past does **not** backfill — the first run is the next
occurrence on or after today.

### Statistics

Everything in `lib/stats.ts` aggregates in SQL over `amount_base_minor`, so
mixed-currency households add up. Transfers are excluded from income and expense
totals throughout.

`date_trunc`'s unit is inlined as a literal rather than bound as a parameter:
with a bind parameter, Postgres treats the SELECT and GROUP BY expressions as
different and fails with "must appear in the GROUP BY clause". The value comes
from a fixed map, never from user input.

Net worth accumulates a running total over per-month SQL sums rather than using a
window function over every transaction — cheaper and easier to read at this size.

---

## Verified

- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm test`, `npm run build` — all clean
- No `any` in application code
- A non-allowlisted address cannot sign in, and no session cookie is issued
- `/api/cron/recurring` returns 401 without the bearer token, and is idempotent
- Every page renders at 375px with **no horizontal overflow** and no console errors
- Light and dark mode both checked, including charts

## Slovak localisation

The app is set up for a household spending in Slovakia.

- **Formatting is `sk-SK`** — `18 081,00 €` (space thousands, comma decimal,
  trailing symbol), dates as `19. 8. 2026`, Slovak month names, Monday week start.
- **`lib/merchants.ts` is a catalogue of ~110 Slovak merchants** — retail chains,
  drugstores, fuel, transport operators, pharmacies, telcos, energy suppliers,
  insurers and banks — plus 25 shopping centres. Matching normalises away
  diacritics, case and punctuation, so a card description like
  `NAKUP KARTOU 1234 LIDL SK 0521 BRATISLAVA` resolves to Lidl → Potraviny.

  Rule order is load-bearing and tested: `TESCO MOBILE` must resolve to telecom,
  not groceries, so the specific rule precedes the general one.
- **Categories are Slovak** (`Potraviny`, `Bývanie`, `Zdravie a lekáreň`…) and
  come from `SK_CATEGORIES`, which the seed and the importer share — so a
  merchant match always lands on a category that actually exists.
- **CSV import ships bank presets** for Slovenská sporiteľňa, VÚB, Tatra banka,
  ČSOB, 365.bank, mBank and Revolut. Picking the bank auto-maps the columns from
  its known header spellings and sets the date format. `DD.MM.YYYY` and
  `19. 8. 2026` both parse, as do comma decimals and semicolon-delimited files.
- **Imports arrive categorised.** Any row whose description matches a merchant
  gets that merchant's category; a category column in the file still wins if one
  is mapped. The preview shows what was recognised before anything is written.
- **The transaction form autocompletes merchants** and selects the matching
  category — but only while the category is still empty, so it never overrides a
  deliberate choice.
- **Currency order** starts EUR, then CZK / PLN / HUF / UAH — the ones actually
  used on a trip or an online order from here.

### The period filter is one range picker, not two fields

Transactions filter by a single DateRangePicker — shadcn Calendar in range mode,
two months on desktop and one on a phone — with presets (Tento mesiac, Minulý
mesiac, Posledných 7/30/90 dní, Tento rok). Two independent From/To fields made
the user keep both ends consistent by hand.

Two things bit during the build and are worth knowing before touching it:

1. react-day-picker reports the FIRST click of a range as `{from: d, to: d}` —
   shape-identical to a deliberate single-day range. Without the `awaitingEnd`
   flag the picker committed and closed itself after one click.
2. The selection is held in local `draft` state and only pushed to the URL once
   both ends exist. Committing the first click immediately re-rendered the page
   and tore down the popover before the second click could land.

Both ends of the range are also written in a single `updateMany` push; two
sequential single-key updates would each read the same stale params, so the
second would silently drop the first.

A third: below the `sm` breakpoint the presets become a horizontal row whose
intrinsic width (~700px) made the popover wider than a phone screen, so it
rendered half off-canvas. `PopoverContent` now carries
`max-w-[calc(100vw-1.5rem)]` with `collisionPadding`.

**The earlier "no horizontal overflow" check could not have caught this.** It
measured `document.documentElement.scrollWidth`, and the popover is portalled
and fixed-position, so it never contributes to document width. Overlay layers
have to be measured by their own bounding rect against the viewport — which is
now done across ten widths from 1440px down to 375px.

### Toasts use the app's surfaces, not Sonner's palette

The Toaster shipped with `richColors` and `closeButton`. `richColors` replaces
the popover tokens with Sonner's own red/green fills, so an error was a block of
pink that matched nothing else in the app; `closeButton` rendered a small circle
overlapping the top-left corner, half outside the toast.

Both are gone. The toast is now the popover surface with the app's border and
radius, and **only the icon is coloured** — enough to tell success from failure
at a glance without shouting. `--success` was added to both themes for it
(`--destructive` already existed).

The rules live at the bottom of `globals.css`, deliberately **unlayered**:
Sonner injects its own stylesheet, and anything inside an `@layer` loses to it.

Also removed a dead `cn-toast` class the vendored `sonner.tsx` applied — nothing
anywhere defined it, so the styling it implied never existed.

### Currencies show a flag, a code and a symbol

`lib/currencies.ts` holds display metadata; `components/currency-label.tsx`
renders it. Used in all five currency pickers and on account cards, with the
bare symbol in field labels ("Monthly limit (€)", "Rate — 1 CZK (Kč) in EUR
(€)"). Amounts themselves were already symbol-bearing via `Intl`.

The flag is `aria-hidden` — the ISO code is the accessible label, so a screen
reader says "EUR", not "flag of the European Union EUR". Flags are emoji and
inherit the platform font: macOS and iOS draw them, Windows substitutes the
two-letter code. Nothing depends on the flag alone, so that degrades cleanly.

`CURRENCY_META` is typed exhaustively over `CurrencyCode` so the compiler
catches a missing entry, but reads go through a `Partial` view keyed by
`string`. Stored rows can name a currency the picker no longer offers, and
pretending otherwise would be a lie the type system happily tells.

**HRK was removed** — Croatia adopted the euro on 1 January 2023, so the code no
longer exists. Any historical row still holding it renders via the fallback
rather than crashing.

### The merchant field is a Combobox, and it pulls in Base UI

It was a plain input with a native `<datalist>` — browser-rendered, unstyled,
prefix-matching only, and on a 110-item list it spilled off the side of the
screen. It is now shadcn's Combobox, which filters on substrings ("lek" finds
Lekáreň, Planeo E*lek*tro and Te*lek*om).

**This adds `@base-ui/react` alongside Radix.** `npx shadcn add combobox`
installs the Base UI implementation even under the `radix-nova` style — there is
no Radix combobox in the registry. Two primitive libraries in one app is a real
cost; it was accepted because the alternative was hand-rolling a filtered
listbox with its own keyboard and ARIA handling.

That mix has a sharp edge, and it bit twice. **A Base UI popup inside a Radix
modal needs two separate fixes**, and each failed silently in a different way:

1. **Clicks.** Radix's Dialog sets `pointer-events: none` on `<body>` and
   re-enables it only inside its own portal. The Base UI popup portals
   elsewhere, so it inherited `none` — the list rendered and the keyboard
   worked, but every mouse click passed straight through it. Fixed with
   `pointer-events-auto` on `ComboboxContent`.
2. **Scrolling.** Radix's Dialog locks scroll with react-remove-scroll, which
   permits wheel events only within its own subtree. A popup portalled to
   `<body>` sits outside it, so a long list could not be scrolled by mouse or
   trackpad at all — arrow keys moved it, the wheel did nothing. Fixed by
   portalling the popup *into* the dialog: `hooks/use-portal-container.ts`
   resolves the enclosing `[role="dialog"]` (or drawer) and hands it to Base
   UI's `container`, which the vendored `combobox.tsx` now forwards.

`usePortalContainer` uses a ref rather than state because `container` accepts a
`RefObject` — so there is no setState-in-effect and no extra render. Outside a
dialog the ref stays null and the popup portals to `<body>` as usual, which is
what the transactions-page filter relies on.

Portalling into the dialog then caused a **third** problem, which is why
`globals.css` carries `[data-base-ui-portal] { display: contents }`. Base UI
mounts every portal as a real `<div>`, and inside the dialog that div became a
child of its `grid gap-4`. It had no height, but it still took a grid row and
its gap: opening any dropdown grew the dialog 603 → 619px, and because the
dialog is centred with a `-50%` translate, it slid 8px up and sprang back on
close. `display: contents` makes the wrapper generate no box; the popup is
positioned out of flow, so placement is unaffected.

Both were found by driving the real UI. A screenshot of an open list looks
identical whether or not it can be clicked or scrolled.

The field stays free text — it is "merchant *or* note", so "Obed v práci" is as
valid as "Lidl". The form binds to `inputValue`; `onValueChange` fires only on a
real pick.

### Long pickers are searchable; short ones stay plain Selects

`components/searchable-select.tsx` is the value-bound counterpart to the
merchant combobox: the value is an id, the typed text only ever filters, and
free text is never accepted. It is used for the four category pickers — the
transaction form, the budget form, the recurring form and the transactions
filter — where the list is 20+ entries and scrolls.

Everything shorter stays a plain `Select`: account (3), currency (15), whose
expense (2), type, sort, frequency. A search box on a three-item list is worse
than no search box.

### Picking a merchant uses an exact map, not the fuzzy matcher

Fourteen merchants deliberately carry a needle longer than their display name —
`Metro` matches on `"metro cash"` so a bare "metro" cannot over-match. Running
the fuzzy matcher on a *chosen* name therefore failed for all fourteen, and
picking "Metro" from the list silently left the category empty.

Picks now resolve through `CATEGORY_BY_MERCHANT`, which is exact. Free text
still goes through `matchMerchant`. Both paths are covered by tests.

Separately, `normalizeDescription` now treats `.` as a separator, so `DR.MAX`,
`Dr. Max` and `dr max` all collapse to `dr max`. Before this the canonical name
"Dr. Max" did not match its own rule while a real bank line `DR.MAX LEKAREN`
did.

### Dates use shadcn Calendar, never the native picker

A native input type=date renders the host OS picker, which on macOS shows
month/day/year regardless of page locale — wrong for Slovakia and visually
unrelated to the rest of the UI. components/date-picker.tsx wraps shadcn
Calendar in a Popover: Slovak locale, Monday first, month/year dropdowns,
optional clear button. It is used in all six places a date is entered
(transaction date, both transaction filters, recurring start, goal target date,
goal contribution date). ISO strings go in and out, so nothing downstream had
to change.

### The interface is translated; English and Russian ship

`next-intl`, **403 keys** in `messages/en.json` and `messages/ru.json`. The
locale lives in a cookie rather than the URL: this is a two-person app, nobody
shares links, so a `/ru/...` prefix on every route would buy nothing.

`lib/locale.ts` holds the shared constants (no `server-only`, so client
components and the test can import it); `lib/locale-server.ts` does the cookie
read. Switching is a plain server action that sets the cookie and revalidates
the whole tree — every rendered string depends on it.

**Components contain no user-visible literals.** That is enforced, not merely
intended: `react/jsx-no-literals` runs over `app/**` and `components/**` (minus
vendored `components/ui/**`), so a hardcoded string is a lint error. Punctuation
and the status code `404` are exempt — they read the same in every language.

`tests/messages.test.ts` guards the catalogues: identical key sets, identical
ICU placeholders per key, no empty strings, and a check that `ru` is not just a
copy of `en`. The placeholder check is brace-aware rather than a regex — in
`{count, plural, one {account} other {accounts}}` the branch bodies are not
arguments, and a regex reports a false mismatch as soon as a translation writes
its branches in Cyrillic.

### Dates and money follow the interface language

`en` maps to **en-GB**, not en-US: the household is in Europe, so
day-before-month and a trailing euro are what people expect even reading
English.

| | en | ru |
| --- | --- | --- |
| money | `€16,982.00` | `16 982,00 €` |
| date | `17 Aug 2026` | `17 авг. 2026` |
| axis | `Aug 26`, `€2.8k` | `авг. 26`, `2,8 тыс. €` |

The euro sits *before* the amount in English and *after* it in Russian; that is
`Intl`'s doing, not a rule this codebase encodes.

Weekly chart buckets are labelled by their span — `3–9 Aug`, or `29 Jul–4 Aug`
across a month boundary — not by their first day. Labelling a week the same way
as a day made the two granularities indistinguishable on an axis the user can
switch. A span reads correctly in both languages without needing a translated
"week of" prefix, which `lib/date.ts` could not resolve anyway.

`lib/formats.ts` maps each interface language to a date-fns locale and an Intl
tag. Two accessors return the same bound helpers: `useFormats()` for components,
and `getFormats()` for **async** Server Components, which cannot call hooks.
Using the hook in an async component typechecks fine and fails at runtime, so
the two are deliberately separate rather than one clever helper — I hit exactly
that on `member-split` and three pages.

The display helpers in `lib/date.ts` take the locale as a **required** argument.
A default would let a missed call site render in the wrong language and still
compile; making it required had the compiler list all 22. `bucketKey` and the
ISO helpers stay locale-independent — they produce grouping keys, not text, and
a locale-dependent key would silently reshape the statistics.

Category names stay Slovak by design: those are user data, editable, not chrome.


## Who did what

A transaction points at three people, all nullable:

| column | meaning |
| --- | --- |
| `paid_by_user_id` | **whose** expense or income it is — what the stats split by |
| `created_by_user_id` | **who typed it in** |
| `updated_by_user_id` | who last edited it; null until someone does |

The first two already existed and were always equal. Recording something for
your partner is just setting `paid_by` to them while `created_by` stays you —
the dashboard's "who spent what", budgets and every total follow `paid_by`, so
the entry counts as hers exactly as if she had added it.

`updated_by` is new (migration `0001`). It is deliberately separate from
`created_by` so correcting a typo on an on-behalf-of entry does not rewrite its
authorship.

**The attribution line is off by default.** For most rows the payer and the
person who typed it in are the same, and saying so on every line is noise. The
"Who entered" switch in the transactions toolbar reveals it, and the preference
is remembered per browser in localStorage.

`hooks/use-preference.ts` uses `useSyncExternalStore` rather than
`useState` + an effect: the server has no localStorage, so the server snapshot
is the default and React swaps in the stored value during hydration — no
setState-in-effect cascade (which the React Compiler lint rule rejects anyway),
and two controls bound to the same key stay in step.

One bug fixed on the way: the form defaulted "whose expense" to `members[0]`,
which is ordered by email — so it could silently attribute your own entries to
your partner. It now defaults to the signed-in user.

## Known gaps

- **Category icons are stored but not rendered.** The `icon` column holds a
  Lucide name; the UI shows a colour dot. Rendering needs a name→component map.
- **Transfers cannot be edited**, only deleted and re-created. Editing one leg
  correctly means reconciling both plus the link; the action rejects it
  explicitly rather than doing it half-way.
- **`lib/recurring.ts` has no unit test** because it imports `server-only` and
  needs a live database. Its scheduling maths (`advanceByFrequency`, including
  month-end clamping and the zero-interval guard) is covered in `tests/date.test.ts`,
  and idempotency was verified against the running app.
- **Goal contributions are standalone rows.** Linking one to a real transaction
  is modelled in the schema (`transaction_id`) but not exposed in the UI.
- **No end-to-end test suite.** Playwright was used to verify rendering during
  the build and then removed rather than left as an unused dependency.

## iOS 27 · Liquid Glass redesign (2026-10-02)

The boards are the `iOS27 ·` frames in the original design file, which is not
part of this repository.

- **One interface at every width.** ≥768px renders the phone UI in a centred
  440px column; the desktop sidebar and header are gone.
- **Glass is CSS** (`app/ios.css` `.glass`): blur + saturate, tint, a lit 1px
  rim, soft shadow. Chromium additionally refracts the backdrop at the edges
  through a generated SVG displacement map (`components/ios/liquid-lens.tsx`),
  applied only after hydration. WebKit cannot run SVG filters on a backdrop,
  so iPhones get frosted glass with the rim — no fallback hacks.
- **Motion:** push/pop are React `<ViewTransition>`s keyed by the link's
  `transitionTypes` (`ios-push` / `ios-pop`); tab switches carry no type and
  stay instant. The back button pops real history inside a document view
  transition (`components/ios/nav-stack.tsx`), because `router.back()` cannot
  carry a type. The large title collapses with CSS scroll-driven animations;
  the tab bar minimises and Обзор's toolbar splits from a rAF scroll hook +
  motion `layoutId`s. «+» morphs into the entry sheet via a named view
  transition. Native edge-swipe back in the standalone PWA is left alone.
- **Sheets** are Base UI Drawers (vaul is unmaintained).
- **Glyphs** are a self-hosted Material Symbols Rounded subset
  (`lib/symbols.ts` → `node scripts/fetch-symbols.mjs`, then bump `?v=` in
  `app/ios.css`). SF Pro is used directly on Apple devices via the system
  font stack; Inter is only the fallback.
- **Charts** moved off Обзор to `/stats`, pushed from the KPI tiles.
- **Face ID** is a WebAuthn passkey app-lock: pages under `(app)` are not
  rendered while the session is locked (`AppLockBoundary`), actions refuse
  with `appLocked`. Passkeys need https — test it on the real domain, not a
  LAN IP.
- **Dev server:** on this machine Watchpack hits EMFILE; run
  `WATCHPACK_POLLING=true next dev`.
