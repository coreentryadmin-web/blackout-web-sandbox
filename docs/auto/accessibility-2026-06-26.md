# Accessibility Audit — 2026-06-26 (accessibility-audit SDLC job, first run)

**Method:** AGGRESSIVE deep-pass. (1) Live Chrome-bridge audit of 8 key pages on production `https://blackouttrades.com` (browser pre-authed) — computed contrast scanner (WCAG sRGB formula, gradient/decorative false-positives filtered), accessible-name checks on buttons/links, heading hierarchy, landmarks, lang, skip-link, unlabeled inputs. (2) 5-dimension multi-agent code audit (contrast · ARIA/semantics · keyboard/focus · forms · reduced-motion), every finding adversarially verified by a second agent against the actual source. Repo: `blackout-cron` (isolated clone). tsc + `next build` green pre- and post-change.

**Result:** `9fad418` — **23 verified WCAG fixes pushed to main** (22 from the code audit, all adversarially confirmed real; +1 from the live audit). Plus a clean baseline: zero banned-grey regressions, strong reduced-motion coverage (no findings), well-built Nav/Modal/Tabs/focus-trap primitives.

---

## ✅ FIXED → main (`9fad418`) — 23 findings, tsc+build green

### Contrast — WCAG 1.4.3 AA (11 fixes)
| # | File:line | Before → After | Ratio | Sev |
|---|---|---|---|---|
| 1 | `TickerDrawer.tsx:165,167` | `text-rose-800` → `text-rose-400` | 2.55 → 7.6 | **P0** |
| 2 | `TickerDrawer.tsx:160,162` | `text-emerald-800` → `text-emerald-400` | 2.66 → 10 | **P0** |
| 3 | `clerk-theme.ts:33` | hint `text-white/40` → `/55` | 3.68 → 6.3 | P1 |
| 4 | `clerk-theme.ts:48` | divider `text-white/40` → `/55` | 3.68 → 6.3 | P1 |
| 5 | `clerk-theme.ts:35` | placeholder `text-white/30` → `/55` | 2.51 → 6.3 | P1 |
| 6 | `GexHeatmap.tsx:2399` | inactive cell value `text-white/40` → `/55` | 3.68 → 6.3 | P1 |
| 7 | `SpxCommentaryRail.tsx:280` | status `text-bear/80` → `text-bear-text` | 3.85 → 6.9 | P1 |
| 8 | `embeds/NightHawkRadar.tsx:59` | status `text-bear/80` → `text-bear-text` | 3.85 → 6.9 | P1 |
| 9 | `GexHeatmap.tsx:1970` | "Puts" label `text-bear/80` → `text-bear-text` | 3.85 → 6.9 | P2 |
| 10 | `globals.css:6181` | `.spx-alert-sell` `text-rose-400/70` → `text-rose-400` | 4.08 → 7.6 | P2 |
| 11 | `NightHawkFlowPanel.tsx:56` | edition date `text-indigo-600/60` → `text-indigo-400` | **1.82** → 6.8 | P1 *(live-audit catch, /flows)* |

### ARIA / landmarks — 1.1.1 / 4.1.2 / 1.3.1 / 2.4.1 (4 fixes)
| # | File | Fix | Sev |
|---|---|---|---|
| 12 | `ui/PageShell.tsx` | root `<div id="main">` → `<main>` — gives **/flows, /heatmap, /nighthawk** a real `main` landmark (ref type widened to `HTMLElement`) | P1 |
| 13 | `admin/AdminApiEventDetail.tsx:101` | icon-only `✕` close button → `aria-label="Close"` | P1 |
| 14 | `admin/AdminUi.tsx:32` | decorative progress-ring `<svg>` → `aria-hidden="true"` | P2 |
| 15 | `desk/DarkPoolPanel.tsx:239` | clear-filter button `aria-label` `"Close"` → `"Clear ticker filter"` | P2 |

### Keyboard / focus — 2.1.1 / 2.4.7 (6 fixes)
| # | File | Fix | Sev |
|---|---|---|---|
| 16 | `desk/VelocityRadar.tsx:55` | clickable ticker `motion.div` → `role/tabIndex/aria-label/onKeyDown` (guarded on `onTickerClick`) | **P0** |
| 17 | `desk/SplitFlowRadar.tsx:59` | same pattern | **P0** |
| 18 | `desk/NightHawkFlowPanel.tsx:74` | same pattern | **P0** |
| 19 | `admin/AdminSpxDashboard.tsx:591` | clickable `<tr>` expander → `role/tabIndex/aria-expanded/onKeyDown` | P1 |
| 20 | `desk/DarkPoolPanel.tsx:224` | search input `outline-none` → added `focus-visible:outline-*` (a ring was defeated by the inline `boxShadow`, so used `outline`) | P1 |

### Forms — 3.3.1 / 3.3.2 / 4.1.2 (3 fixes)
| # | File | Fix | Sev |
|---|---|---|---|
| 21 | `nights-watch/NightsWatchPanel.tsx` | 5 required inputs → `aria-required="true"`; validation error `<p>` → `id`; inputs → `aria-describedby` it | P2 |
| 22 | `desk/GexHeatmap.tsx:1647` | ticker combobox → `aria-activedescendant`; option `<li>` → `id` (arrow-key-active option now announced) | P2 |

---

## ✅ Clean / no action

- **Reduced motion (2.3.3 / 2.2.2):** NO findings. `globals.css:114-128` universal reset (`animation-iteration-count:1 !important` neutralizes ALL infinite keyframes incl. marquees/tapes) + `MotionProvider reducedMotion="user"` + `usePulse()` opacity guards + per-component `useReducedMotion()`. Defense-in-depth; nothing keeps moving under `reduce`.
- **No-grey rule:** 0 violations (`text-gray/grey/zinc/neutral/slate` count = 0).
- **Foundations:** global `:focus-visible { outline: 2px solid #38bdf8 }`; working skip-to-content link (`layout.tsx`); `lang="en"`; Modal focus-trap (record/restore/Tab-wrap/Esc/scroll-lock); Tabs roving-tabindex; Nav `role="banner"`/`menubar`, labeled hamburger+drawer, `aria-hidden` decorative glyphs; ProductMark `role="img"`+title; titled iframes. No raster `<img>` (no alt gaps); every page has an `<h1>`, clean h1→h4 hierarchy, no positive tabIndex.
- **Live pages swept:** `/` `/upgrade` `/dashboard` clean (no contrast/name/alt failures). `/heatmap` `/nighthawk` `/flows` `/terminal` only surfaced the items below.

---

## ⚠️ FLAGGED (design-judgment / data-viz — NOT auto-fixed) — see task

These need a visual/product call, so per the FIX-vs-FLAG policy they were NOT pushed to main:

1. **Heatmap cell value labels** (`/heatmap`, GexHeatmap) — white 11px on tinted GEX cells measured **3.65:1** on bear/red-intensity cells. Data-viz: white-on-variable-cell contrast varies by magnitude. Proper fix needs a design call (text-shadow for legibility, or dynamic label color by cell luminance). The 3958-line component → verify visually.
2. **`/nighthawk` low-conviction tag** — a small `·low`-style tag in red `#ff2d55` at opacity 0.7 measured **3.09:1**. Runtime-rendered (not in the `CONVICTION_STYLE` map, which is AA-safe). Locate + bump to `text-bear-text` or drop the opacity. P2.
3. **`/flows` ghost toolbar controls** — `★WATCH` / `CSV` / `▶ Replay` rendered at opacity ~0.3 (**~1.88:1**) in their resting state. If these are *active* controls (brighten on hover) this is a real readability issue; if *disabled*, it's exempt. Confirm state, then raise resting opacity. P2.
4. **Nav `<nav>` landmark / `role="menubar"`** — the site nav has `role="banner"` but no `navigation` landmark; the center pill uses the heavier `role="menubar"` app-menu pattern (arrow-key contract). A screen-reader landmark list won't show "navigation." Retrofitting a `<nav>` cleanly vs. the menubar architecture is a design call. P2.
5. **Home step numerals `01/02/03`** — colored accent (purple/cyan/green) at opacity 0.5, **2.25–3.54:1**. Decorative-adjacent step indicators next to section headings; raise opacity or treat as purely decorative. P2.

---

## Next run
- Resolve the 5 flagged design-judgment items (visual verify on a live/market-open session).
- Re-scan `/admin` sub-views (cron/API forensics drawers) and the embed pages with the contrast scanner once authed.
- Regression-watch: keep the no-grey count at 0 and the reduced-motion reset intact.
