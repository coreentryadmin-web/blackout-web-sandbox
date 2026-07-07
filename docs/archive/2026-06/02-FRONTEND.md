# 02 — FRONTEND COMPONENT INVENTORY & UX/UI AUDIT (Deliverable D + feeds M)

**Scope:** `src/app/**` (routes, layouts, route-state files) + `src/components/**` (131 `.tsx` components).
**Mode:** READ-ONLY. Evidence-grounded; runtime-only claims flagged "Not verified".
**Stack verified:** Next.js 14.2.35 App Router · React 18 · `@clerk/nextjs` ^5.7.6 · framer-motion ^11 · recharts ^2.12 · swr ^2.2 · lucide-react · `clsx`. No CSS-in-JS lib; one global `globals.css` (11,033 lines / ~305 KB) + Tailwind 3.4.
**Verdict (headline):** The design-system layer (`src/components/ui/*`) is genuinely good — accessible Modal/focus-trap, polymorphic Button, honest empty/loading/error states, broad reduced-motion coverage (20 files). It reads close to institutional-grade on the marketing surface and the newer tools (Night's Watch). It is held back from "institutional-grade" by: a few keyboard-accessibility gaps on click-to-open cards, a very large monolithic CSS bundle, heavy per-card framer-motion `layout` animation on a hot SSE tape, `window.prompt`/`confirm` used for a money action, a 1s client poll on the SPX desk, internal "analysis" docs pages shipping to prod, and pervasive inline-style hex colors that bypass the design tokens.

---

## A. Route Inventory

| Route (URL) | File | Auth gate | Rendering | Notes |
|---|---|---|---|---|
| `/` | `src/app/(site)/page.tsx` | public | server shell + client sections | Landing: Hero/Marquee/Features/Edge/FAQ/Pricing/Footer + CustomCursor |
| `/dashboard` | `src/app/(site)/dashboard/page.tsx` | `requireTier("premium")` | `revalidate=0` | SPX Slayer war room (`SpxDashboard`) |
| `/flows` | `src/app/(site)/flows/page.tsx` | premium | dynamic | HELIX (`FlowFeed`) + DNA helix backdrop |
| `/heatmap` | `src/app/(site)/heatmap/page.tsx` | premium | dynamic | GEX/VEX (`Heatmap` → `GexHeatmap`) |
| `/terminal` | `src/app/(site)/terminal/page.tsx` | premium | dynamic | Largo AI chat (`LargoTerminal`) full-viewport |
| `/nighthawk` | `src/app/(site)/nighthawk/page.tsx` | premium | dynamic | Night Hawk playbook + Night's Watch |
| `/admin` | `src/app/(site)/admin/page.tsx` | `requireAdmin()` | `revalidate=0` | Ops control room |
| `/upgrade` | `src/app/(site)/upgrade/page.tsx` | public | static | Pricing/plan ladder + Whop sync |
| `/sign-in`, `/sign-up` | `src/app/sign-in/[[...sign-in]]/page.tsx`, `…/sign-up/…` | public | Clerk | `AuthShell` |
| `/track-record` | `src/app/track-record/page.tsx` | public | force-dynamic | Public proof + embed snippet |
| `/embed/track-record` | `src/app/embed/track-record/page.tsx` | public, framable | force-dynamic | Chrome-less iframe card |
| `/offline` | `src/app/offline/page.tsx` | public | static | SW offline shell |
| `/docs/**` (17 pages) | `src/app/docs/**/page.tsx` | premium (`docs/layout.tsx`) | static | **Internal analysis artifacts — see I-08** |
| `__clerk/[[...path]]` | `src/app/%5F%5Fclerk/[[...path]]` | — | — | Clerk proxy catch-all (URL-encoded dir name) |
| Route-state | `error.tsx`, `global-error.tsx`, `loading.tsx`, `not-found.tsx`, `offline/page.tsx` | — | client/server | All on-brand, dependency-light ✅ |

**Layouts:** root `app/layout.tsx` (fonts via `next/font`, Clerk, Motion/Onboarding/PWA providers, skip-link), `(site)/layout.tsx` (hoists fixed `<Nav/>`), `docs/layout.tsx` + nested `docs/polygon|unusual-whales|cursor-api-analysis` layouts.

## B. Component Inventory (by domain)

- **Design system (`ui/`, 15 files):** Button, Card, Panel/PanelHeader, Stat, Badge, Table(+THead/TBody/TR/TH/TD), EmptyState, Skeleton, PageShell, PageHeader, Kicker, Modal/Drawer, Tabs, `useFocusTrap`. Barrel `ui/index.ts`. **This is the strongest layer.**
- **Desk (`desk/`, ~45):** SpxSniperHeader, SpxDeskPanels, SpxTradeAlerts, SpxChart, SpxCommentaryRail, SpxStructure/Technicals/Track/DayPerformance, FlowAlertStream, FlowBrief, FlowMomentumChart (lazy), NetPremiumLeaderboard, StrikeStackDetector, SplitFlowRadar, VelocityRadar, SectorFlowPanel/Thermal, GexHeatmap/GexDealerPanel, DarkPoolPanel/Spark, LargoTerminal/MessageBody/ThinkingState, TickerDrawer, WatchlistBar, Benzinga rails, EngineStatusBar, LevelLadder.
- **Night Hawk / Night's Watch:** PlaybookBoard, PlaybookPlayRow, PlayDetailModal, DayTradeAgentWorkspace, DayTradeSignalCard, AgentSidebar/PowerModal/FilterFields (kept but no longer rendered), NightsWatchPanel, NightsWatchDetailModal, 3 backdrops.
- **Landing:** Hero, Features, Edge, Marquee, Faq, Pricing(+Backdrop), Footer, FloatingPanel, FadeInImage, LandingCta, LandingBackdrop.
- **Admin (16):** AdminAnalyticsDashboard + Api/Cron/NightHawk/Operations/Spx dashboards, SpxTerminal, HealthBanner, JournalEditor, AdminUi.
- **Embeds (13):** TrackRecord, LiveFlowTape, NightHawkRadar, LiveMarketPulse, FlowVolumeChart, TradingViewWidget, EmbedFrame, Dashboard/Flows/Heatmap/NightHawk embed wrappers.
- **Global chrome:** Nav, LandingChrome, MotionProvider, OnboardingGuide/Trigger, SessionCacheGuard, PwaRegister, ScrollProgressBar, CustomCursor, DnaHelixBackground(+Lazy), AuthBackground, BrandImage, PageBanner, marks (ProductMark/SharedSigilDefs/geometry).

---

## C. What is already strong (keep)

- **Accessible Modal** (`ui/Modal.tsx`): `role="dialog"`, `aria-modal`, portal, scrim, scroll-lock, `useFocusTrap`, return-focus, reduced-motion. Reused by Onboarding + drawers.
- **Polymorphic Button** (`ui/Button.tsx`): button/Link/external `<a>`, loading spinner with `aria-busy`, `disabled`/inert handling, focus-visible ring, motion-reduce scale guards.
- **Honest data states**: `useMergedDesk` LIVE/STALE logic; FlowFeed amber "Stale Xm" badge when newest print > 5 min; NightsWatchPanel renders `—` + status tag instead of a fake P&L.
- **Reduced-motion**: respected in 20 components incl. every backdrop, Nav, CustomCursor, Skeleton.
- **Route-state pages**: `error/global-error/loading/not-found/offline` are all branded and dependency-light (no Nav/heavy imports) so they render even when the tree faults.
- **Brand guard working**: 0 banned grey classes (`text-grey/zinc/neutral/gray-*`), 0 raw `<img>` (all `next/image`).
- **Skip-link** in root layout; CSP/security headers in `next.config`.

---

## D. FINDINGS (per-issue blocks)

### I-01 · Monolithic 305 KB / 11,033-line `globals.css` ships on every route
- **Severity:** High
- **File:** `src/app/globals.css` (imported once in `src/app/layout.tsx:12`)
- **Code reference:** `wc -l` = 11033 lines, 305,441 bytes. `layout.tsx:12 import "./globals.css";`
- **Why it's a problem:** Tailwind purges unused *utility* classes, but this file is overwhelmingly hand-authored component CSS (`.flow-card`, `.nighthawk-*`, `.spx-sniper-*`, `.largo-*`, `.admin-*`, keyframes). All of it is concatenated into one stylesheet loaded on the landing page even though a logged-out visitor never sees `.admin-*` or `.spx-sniper-*`. It is render-blocking and uncacheable-per-route.
- **Impact at 500 concurrent users:** Every first-paint (landing, sign-in) downloads + parses ~305 KB of CSS the visitor will never use → slower LCP/FCP, more CDN egress, worse mobile TTI. At 500 concurrent cold loads this is the single biggest static-asset cost on the critical path.
- **Recommended fix:** Split tool-specific CSS out of the global sheet and co-locate as CSS Modules (or `@layer` files imported only by the route/component that needs them) so admin/desk/nighthawk CSS is route-scoped and code-split. Audit for dead rules with a coverage pass. Target a <40 KB global sheet for the public surface.
- **Example change:** move `.nighthawk-*`/`.spx-sniper-*`/`.largo-*`/`.admin-*` blocks into `dashboard.module.css`, `nighthawk.module.css`, etc., imported by their pages; keep only tokens + shared chrome in `globals.css`.

### I-02 · Flow tape animates up to 150 `motion.div` nodes with `layout="position"` on a live SSE stream
- **Severity:** High
- **File:** `src/components/desk/FlowAlertStream.tsx`
- **Code reference:** L242-282 `displayed.map(... <motion.div key={`${flow.ticker}-${flow.alerted_at}-${i}`} layout="position" initial={{opacity:0,x:-12,scale:0.98}} ...>`; `RENDER_LIMIT = 150` (L13). New alerts are prepended (`setAlerts((prev) => [alert, ...prev])` in FlowFeed L364).
- **Why it's a problem:** `layout="position"` makes framer measure + FLIP-animate every visible card whenever the list reorders. Prepending a new alert shifts all 150 nodes → 150 layout animations per SSE message. During fast flow (whale bursts), SSE can fire many messages/sec. Each card also carries multiple inline `style` objects (new object identity every render) and `AnimatePresence`.
- **Impact at 500 concurrent users:** This is client-side cost (per browser), but it directly degrades the flagship "REAL-TIME TAPE" — jank/dropped frames on mid-range laptops and most phones during exactly the high-flow moments the product is selling. Combined with the per-`alerts` `useMemo` fan-out in FlowFeed (I-03), a busy tape can pin a core.
- **Recommended fix:** Drop `layout="position"` (the prepend already implies "new on top"); animate only entry of the *new* first row (`i===0`), render the rest static. Or virtualize the list (only ~20 cards are visible). Memoize the row into a `React.memo` `FlowCard` and hoist the per-card inline style objects to module constants / className-driven variants.

### I-03 · FlowFeed recomputes ~9 `useMemo` derivations on every `alerts` change
- **Severity:** Medium
- **File:** `src/components/FlowFeed.tsx`
- **Code reference:** `callCount/putCount` (L146), `compoundTickers` (L156), `splitFlowMap` (L162), `earningsDays` (L201), velocity (L214), `coordinatedTickers` (L253), `sectorFlowEntries` (L271), `nighthawkPlaysWithFlow` (L294), `displayAlerts` (L416) — all keyed on `alerts`. Each SSE message does `setAlerts((prev) => [alert, ...prev])` creating a new array → all nine recompute, several O(n) or O(n·m) (e.g. `coordinatedTickers` is `alerts × darkPoolPrints`).
- **Why it's a problem:** A single new print invalidates the entire derived-state graph and re-runs every scan over a list that can grow to thousands. `nighthawkPlaysWithFlow` does `alerts.filter()` per play inside a `.map()` (O(plays·alerts)).
- **Impact at 500 concurrent users:** Per-browser CPU; on a long session with a deep tape, each whale burst triggers a multi-pass recompute. Compounds I-02 to produce visible stutter.
- **Recommended fix:** Cap the working set used for derivations (e.g. last N by time) like `compoundTickers` already does (`.slice(0,500)`). Debounce/batch SSE-driven `setAlerts` (coalesce bursts into one state update per animation frame). Precompute `event_at`/`alerted_at` epoch on ingest to avoid `new Date()` in every pass.

### I-04 · Flow card is click-to-open but keyboard-inaccessible (no role/tabindex/keydown)
- **Severity:** High (a11y)
- **File:** `src/components/desk/FlowAlertStream.tsx`
- **Code reference:** L268-283 `<motion.div ... onClick={() => onTickerClick?.(flow.ticker)} className={cardCls}>` — opens the `TickerDrawer`, but the element is a plain `div` with no `role="button"`, `tabIndex={0}`, or `onKeyDown`.
- **Why it's a problem:** The primary drill-down interaction of the flagship HELIX tape cannot be reached or activated by keyboard or screen-reader users. Contrast with `NightsWatchPanel` `PositionCard` (L504-518) which does this correctly. The inconsistency proves the pattern is known.
- **Impact at 500 concurrent users:** Fails WCAG 2.1.1 (Keyboard) / 4.1.2 (Name, Role, Value) on the core feature; an institutional buyer's accessibility review flags it. Affects every keyboard/AT user.
- **Recommended fix:** Add `role="button"`, `tabIndex={0}`, `aria-label`, and an `onKeyDown` for Enter/Space (mirror `PositionCard`). Even better, extract a shared `<ClickableCard>` so the tape, watchlist rows, and Night's Watch all share one accessible click affordance.

### I-05 · Money action (Close position) uses `window.prompt` / `window.confirm`
- **Severity:** High
- **File:** `src/components/nights-watch/NightsWatchPanel.tsx`
- **Code reference:** L445 `const raw = window.prompt(`Close ${position.ticker} ... exit premium per contract?`, ...)`; L477 `if (!window.confirm(`Delete ... This cannot be undone.`))`.
- **Why it's a problem:** Native `prompt`/`confirm` are unstyled OS dialogs (off-brand, no validation affordance, no number-pad on mobile, blocked entirely in some embedded/PWA contexts and increasingly throttled by browsers). Closing a position is the only place the user types a dollar figure that drives realized P&L — doing it through a `prompt` is the least institutional-grade interaction in the app and is the weakest link in an otherwise polished panel.
- **Impact at 500 concurrent users:** On installed PWA / certain mobile browsers `prompt` can be suppressed → user cannot close a position at all (silent dead-end). Inconsistent UX undermines trust on a financial action.
- **Recommended fix:** Replace with a small `<Modal>` (already available) containing a numeric input pre-filled with `valuation.mark`, inline validation, and a typed-confirm for Delete. Reuse the existing `Modal` + `Button` + field styles already in this file.

### I-06 · SPX desk polls the pulse endpoint every 1s when SSE is unavailable
- **Severity:** Medium
- **File:** `src/hooks/useMergedDesk.ts`
- **Code reference:** L11 `const PULSE_REST_MS = 1_000;` used as `refreshInterval` (L72-77) when `pulseSseConnected` is false; SSE path relaxes to 10 s.
- **Why it's a problem:** When the pulse SSE fails to connect (proxy, corporate network, mobile background), each dashboard client falls back to a **1 req/s** poll. The endpoint is a cache-reader, so it won't hit upstream providers, but it is still 1 request per second per open dashboard.
- **Impact at 500 concurrent users:** If even a fraction of 500 concurrent dashboards are on the REST fallback, that is hundreds of req/s against the Next server / Redis purely for pulse — meaningful Railway CPU and connection pressure even though no provider quota is touched. The 2s flow poll (`FLOW_MS`) and 10s desk poll add to it. *Not verified — needs prod telemetry on SSE-connect success rate to size the real fallback population.*
- **Recommended fix:** Raise the REST-fallback floor to 2–3 s, add jitter so 500 clients don't align on the same tick, and back off when `document.hidden` (SWR already sets `refreshWhenHidden:false` ✅, but the pulse `refreshInterval` function should also early-return 0 off-session — it already returns 0 when not live ✅; the gap is only the 1s live-fallback cadence).

### I-07 · After-hours brief line derived from local `new Date().getHours()` → hydration/timezone mismatch
- **Severity:** Medium
- **File:** `src/components/desk/FlowBrief.tsx`
- **Code reference:** L42-45 `function afterHoursLine() { const h = new Date().getHours(); return AFTER_HOURS_LINES[h % AFTER_HOURS_LINES.length]; }` and `useState(isRTH())` (L61) where `isRTH` uses ET but `afterHoursLine` uses the *browser local* hour.
- **Why it's a problem:** `getHours()` is the visitor's local timezone, not ET, so the "deterministic by hour" copy picks a different line for a user in PST vs server, and the initial render value can differ between SSR and client → React hydration warning + a copy flash. (Several other components also call `new Date()` in render: GexHeatmap, SpxDayPerformancePanel, FlowAlertStream `timeAgo` — those are mostly client-only or memoized, but this one feeds initial state.)
- **Impact at 500 concurrent users:** Cosmetic + a hydration warning in the console (and a 1-frame text swap). Low functional risk but reads as sloppy on the flagship desk.
- **Recommended fix:** Compute the after-hours line from ET (reuse the `Intl.DateTimeFormat('en-US',{timeZone:'America/New_York'})` already in `isRTH`), and gate first paint behind a mounted flag so SSR and client agree.

### I-08 · 17 internal "analysis" docs pages (7,551 LOC) ship to production behind the premium gate
- **Severity:** Medium (info-leak + bloat)
- **File:** `src/app/docs/**` — e.g. `docs/spx-sniper/cursor-spx-slayer-analysis/page.tsx` (1,146 LOC), `docs/api-probe/page.tsx` (1,229), `docs/claude-api-analysis/page.tsx` (629), `docs/cursor-api-analysis/**`, `docs/system-analysis/page.tsx` (658).
- **Code reference:** `docs/layout.tsx` gates with `requireTier("premium")` — so **any paying user** can read pages titled "cursor-spx-slayer-analysis", "claude-api-analysis", "system-analysis", and live UW/Polygon endpoint probes.
- **Why it's a problem:** These are engineering/architecture notes (which provider endpoints, which models, internal probes) exposed to all premium customers, not just admins. They also add 372 KB of source + 17 build outputs and their own nav components to the bundle/route table.
- **Impact at 500 concurrent users:** Competitive/IP leakage to every subscriber (anyone can buy premium and read how the desk is wired). Build-time and route-count bloat.
- **Recommended fix:** Move these behind `requireAdmin()` (not premium), or exclude from the production build entirely (move to a `/docs` that is `NODE_ENV !== 'production'` only, or to a separate internal app). At minimum re-gate the `docs/layout.tsx`.

### I-09 · DNA helix backdrop runs 4 columns × (24 SMIL `animateMotion` particles + 2-pass SVG bloom filter) full-screen
- **Severity:** Medium
- **File:** `src/components/DnaHelixBackground.tsx`
- **Code reference:** `COLS` = 4 (L193); each `HelixSvg` renders `DOTS_S1`+`DOTS_S2` = 12 particles, each with two `animateMotion` `<circle>`s (L157-186) → ~24 animated nodes/column × 4 = ~96 continuously-animating SMIL elements, all inside a `feGaussianBlur` filter (`stdDeviation` up to 14). Mounted on `/flows` via `DnaHelixBackgroundLazy`.
- **Why it's a problem:** Large blurred SVG filters + SMIL motion are GPU/compositor-heavy and run forever while `/flows` is open — concurrently with the live tape (I-02/I-03). `DnaHelixBackgroundLazy` defers the import (good) and `reduce` disables particles/filter (good), but for the default (non-reduced-motion) user it's a permanent paint cost layered under the busiest page.
- **Impact at 500 concurrent users:** Per-browser; on phones/integrated GPUs the helix + tape together cause fan-spin and battery drain on the page users keep open all session. *Not verified — needs a DevTools perf trace on a mid-tier device.*
- **Recommended fix:** Reduce to 2 columns, cut particle count, drop one blur pass (or pre-rasterize the glow), and/or pause the backdrop animation when `document.hidden` or when the tape is actively streaming. Consider `content-visibility`/disabling on `(pointer: coarse)`.

### I-10 · Pervasive inline-style hex colors bypass the design tokens
- **Severity:** Medium
- **File:** many — `GexHeatmap.tsx` (40 `style={{}}`), `DarkPoolPanel.tsx` (13), `FlowBrief.tsx` (10), `FlowAlertStream.tsx` (9), `FlowFeed.tsx` filter bar (`color:"#00e676"`, `style={{textShadow:...}}` L464, L515-518), `PricingSection.tsx` (13). 201+ `style={{` occurrences across 40 files.
- **Code reference:** e.g. FlowAlertStream L358-367 `style={{ color: isCompound ? "#ffd23f" : isCall ? "#00e676" : "#ff2d55", textShadow: ... }}`; FlowFeed L464 `style={{color:"#00e676",textShadow:"0 0 8px rgba(0,230,118,0.6)"}}`.
- **Why it's a problem:** The same brand colors (`#00e676` bull, `#ff2d55` bear, `#ffd23f` gold) are re-typed as literals dozens of times instead of using the Tailwind tokens (`text-bull`, `text-bear`, `text-gold`) the design system defines. New object literals each render also defeat memoization (ties into I-02). A theme/contrast change can't be made centrally.
- **Impact at 500 concurrent users:** Maintainability + consistency risk (drift between literal hexes and tokens), micro perf (new style objects per render), and harder a11y/contrast tuning. Not a launch blocker but it's why parts of the desk feel "hand-rolled" vs the polished `ui/` layer.
- **Recommended fix:** Replace literal hexes with the existing token utilities / CSS custom props; reserve inline `style` for truly dynamic values (computed widths/positions). Extend the `lint:brand` guard to flag raw bull/bear/gold hexes in JSX.

### I-11 · Stale design-system comments claim "not yet adopted"
- **Severity:** Low
- **File:** `src/components/ui/index.ts`
- **Code reference:** L7 `* NOTE: these are not yet adopted across the app; that's a later batch.` — but `Button/Badge/PageShell/PageHeader/Modal/EmptyState/Skeleton/Tabs` are imported across flows/heatmap/nighthawk/terminal/admin pages and `NightsWatchPanel`. (Note: my own prior MEMORY entry "no src/components/ui" is also now stale — the dir exists with 15 primitives.)
- **Why it's a problem:** Misleading docs for the next engineer; understates the maturity of the system.
- **Impact:** Negligible runtime; documentation accuracy only.
- **Recommended fix:** Update the comment to reflect adoption status and list the remaining hand-rolled holdouts (desk panels still on bespoke CSS).

### I-12 · `LargoTerminal` rebuilds the whole message array on every stream token
- **Severity:** Medium
- **File:** `src/components/desk/LargoTerminal.tsx`
- **Code reference:** L80-87 stream callback: `setMessages((m) => m.map((msg) => msg.id === assistantId ? { ...msg, content: msg.content + token } : msg))` — a full array map + new objects per token, with every message wrapped in a `motion.div` under `AnimatePresence` and `LargoMessageBody` re-parsing markdown.
- **Why it's a problem:** Token-by-token streaming triggers a re-render of the entire message list each token; with a long thread + markdown re-parse per render this is O(messages) work per token. Also `useEffect` `scrollIntoView({behavior:"smooth"})` fires on every `messages` change (L61-63) → smooth-scroll thrash during streaming.
- **Impact at 500 concurrent users:** Per-browser; on long Largo sessions the chat can stutter as the answer streams. Not blocking but noticeable.
- **Recommended fix:** Memoize rendered messages (`React.memo` keyed on `id+content`), only re-render the streaming bubble; throttle the assistant content update (batch tokens per frame) and switch the auto-scroll to `behavior:"auto"` during active streaming.

### I-13 · `revalidate = 0` / `force-dynamic` on every authed page (no static shell, full SSR per request)
- **Severity:** Low–Medium
- **File:** `dashboard/page.tsx:6`, `admin/page.tsx:7`, `track-record/page.tsx:7`, `embed/track-record/page.tsx`, flows/heatmap/nighthawk/terminal (dynamic via `requireTier`).
- **Code reference:** `export const revalidate = 0;` and `export const dynamic = "force-dynamic";`.
- **Why it's a problem:** Correct for auth-gated, per-user data — but it means there is no cached/static app shell; each navigation re-runs the server render + Clerk handshake. The pages themselves are thin (they delegate to client components), so the SSR work is mostly the auth gate.
- **Impact at 500 concurrent users:** Every page hit is a dynamic server render + an `auth().protect()` call. Fine if Clerk + the gate are fast, but it's 500× the per-request server work of a static shell. *Not verified — needs prod p95 on the `requireTier` path.*
- **Recommended fix:** Keep dynamic for data, but ensure the gate is the only server cost (it is) and consider a lightweight static loading shell + client-side gate for the heaviest pages if SSR latency shows up in telemetry.

### I-14 · `embed/track-record` is intentionally framable; verify it's the only frameable route
- **Severity:** Low (verify)
- **File:** `src/app/embed/track-record/page.tsx`
- **Code reference:** file comment "Next does not set X-Frame-Options by default… If a global frame-deny header is later added, this route must be excepted." Meanwhile `next.config` sets `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` globally (headers apply to `/:path*`).
- **Why it's a problem:** The global `SAMEORIGIN` + `frame-ancestors 'self'` headers would actually *block* this public embed from being framed on customer sites — contradicting the embed's purpose. The embed snippet on `/track-record` (page.tsx L34) tells users to `<iframe>` it on their site.
- **Impact at 500 concurrent users:** The social-proof embed may silently fail to render on third-party sites (defeating the growth feature). *Not verified — needs a cross-origin iframe test against prod headers.*
- **Recommended fix:** Add a per-route header exception for `/embed/**` (loosen `frame-ancestors`/drop `X-Frame-Options`) or confirm Clerk/Next route-level header overrides. Test embedding from an external origin.

### I-15 · Admin gate is fetched client-side per session and cached in `sessionStorage`
- **Severity:** Low
- **File:** `src/components/Nav.tsx`
- **Code reference:** L88-114 `fetch("/api/admin/me")` → `sessionStorage.setItem("__admin_flag", ...)`. The `/admin` route itself is server-gated by `requireAdmin()` (good), so this is only for *showing the nav link*.
- **Why it's a problem:** Minor: a `sessionStorage` flag drives a UI affordance; harmless because the route is independently protected. But it adds an extra fetch on first signed-in load for every user (admin or not).
- **Impact at 500 concurrent users:** 500 extra `/api/admin/me` calls on first nav render. Cheap but avoidable.
- **Recommended fix:** Read the admin flag from the Clerk session `publicMetadata` already available client-side (`useUser`) instead of a network round-trip, mirroring how `SpxDashboard` reads `tier` from `publicMetadata`.

### I-16 · FlowAlertStream list keys include the array index
- **Severity:** Low
- **File:** `src/components/desk/FlowAlertStream.tsx`
- **Code reference:** L270 `key={`${flow.ticker}-${flow.alerted_at}-${i}`}` — index `i` in the key while the list reorders (prepend) under `AnimatePresence`.
- **Why it's a problem:** Including `i` means the key of a given alert changes when its position shifts (every prepend), defeating React/AnimatePresence identity → unnecessary unmount/remount + animation glitches. ticker+alerted_at is *nearly* unique already; the `i` is a band-aid for collisions.
- **Impact:** Animation pops/duplicated entry transitions on the tape; extra DOM churn (ties to I-02).
- **Recommended fix:** Use a stable id (compose `ticker|strike|option_type|alerted_at` — the same dedupe key FlowFeed already builds in `seenRef`) and drop `i`.

### I-17 · `NightHawkBackdrop` runs an infinite 9 s brightness filter animation full-screen
- **Severity:** Low
- **File:** `src/components/nighthawk/NightHawkBackdrop.tsx`
- **Code reference:** L18-31 `animate={{ filter: ["brightness(1.12)…","brightness(1.42)…","brightness(1.12)…"] }}` `transition={{ duration: 9, repeat: Infinity }}` over a full-bleed `next/image`. Plus `/nighthawk` also stacks `NightHawkRadarBackdrop` + scanlines.
- **Why it's a problem:** Animating `filter: brightness()` on a viewport-sized image forces continuous repaints. Reduced-motion is handled (static frame ✅), but default users pay a perpetual full-screen repaint while the radar HUD + scanlines also animate.
- **Impact:** Mobile battery/jank on the Night Hawk page. Per-browser.
- **Recommended fix:** Animate `opacity` of a brightness overlay (compositor-only) instead of `filter`, or drop the breathe to a slower/cheaper effect; pause on `document.hidden`.

### I-18 · Heavy inline-styled radars/panels duplicate bespoke chrome instead of `ui/Panel`
- **Severity:** Low
- **File:** `desk/VelocityRadar.tsx`, `desk/SplitFlowRadar.tsx`, `desk/StrikeStackDetector.tsx`, `desk/SectorFlowPanel.tsx`, `desk/DarkPoolPanel.tsx`
- **Code reference:** these use ad-hoc `style={{}}` bars/panels rather than the `Panel`/`PanelHeader`/`Stat`/`Table` primitives the `ui/` layer provides.
- **Why it's a problem:** Two parallel styling systems (polished `ui/` vs hand-rolled desk CSS) → visual drift in spacing, radius, header treatment; more CSS in the global sheet (I-01).
- **Impact:** Consistency/maintenance; the desk reads slightly less unified than landing.
- **Recommended fix:** Migrate the right-column flow panels onto `Panel`/`Stat`/`Table`; this also shrinks `globals.css`.

---

## E. Mobile / responsive notes
- Nav has a proper slide-in drawer with focus-trap + scroll-lock + reduced-motion (`Nav.tsx` L312-381) ✅.
- Dashboard uses a `spx-sniper-triple` grid; the flow tape uses `lg:col-span-8 / 4` with a `grid-cols-1` mobile fallback ✅, but the filter bar (`FlowFeed.tsx` L462) is `flex-wrap` with ~8 controls — on a narrow phone it wraps to 3–4 rows and pushes the tape far down. Consider a compact "filters" sheet on mobile.
- NightsWatch greeks grid is `grid-cols-2 sm:grid-cols-4` ✅ (8 cells never cram).
- CustomCursor correctly disables on `(pointer: coarse)` ✅.

## F. Wording / trading terminology
- Generally strong and on-voice ("REAL-TIME TAPE", "war room", honest "Stale 4m"). Disclaimers present ("Educational only — not financial advice") in onboarding, upgrade, Night's Watch footer ✅.
- Verdict language (HOLD/TRIM/SELL/WATCH) is clear and color-coded to bull/gold/bear/sky consistently ✅.
- Minor: error copy is heavily metaphor-laden ("THE TAPE WENT DARK", "THE DESK HIT A SNAG", "Stand down", "Return to base") — fun and on-brand, but a first-time user hitting an error may not parse "Stand down" as "go back". Keep the metaphor headline but ensure the body has a literal instruction (it mostly does).

## G. Bundle / hydration risk summary
- `globals.css` 305 KB (I-01) is the dominant static cost.
- `recharts` correctly lazy-loaded via `next/dynamic ssr:false` in FlowMomentumChart (`FlowFeed.tsx` L22) ✅; `DnaHelixBackground` lazy-loaded ✅; `ioredis`/`pg` aliased out of client/edge bundles in `next.config` ✅.
- Hydration: only real risk is I-07 (`new Date().getHours()` feeding initial render). Other `new Date()` uses are in effects/memos or client-only paths.

## H. Recommended reuse / split / remove / rename
- **Reuse/extract:** a shared accessible `<ClickableCard>` (fixes I-04, unifies tape/watchlist/positions).
- **Split:** `FlowFeed.tsx` (708 LOC, 9 memos) into `useFlowDerivations()` hook + presentational pieces; split `globals.css` into route-scoped modules.
- **Remove/re-gate:** internal `docs/**` analysis pages (I-08); the unused `AgentSidebar`/Hunt-Modes components if confirmed dead.
- **Redesign:** the Close-position `prompt` → Modal (I-05).
- **Rename:** none blocking; update stale `ui/index.ts` note (I-11).

## I. Launch blockers (for 500-concurrent launch)
1. **I-04** — keyboard inaccessibility of the flagship flow tape (WCAG fail on the core feature).
2. **I-05** — `window.prompt`/`confirm` for closing a position (can be suppressed on PWA/mobile → user can't exit a position).
3. **I-08** — internal architecture/analysis docs readable by any premium subscriber (IP/info leak).
4. **I-01** — 305 KB monolithic CSS on every first paint (LCP/egress at 500 cold loads). *(Strongly recommended pre-scale; not a correctness blocker.)*

Everything else (I-02/03/06/09/12) is performance polish that materially affects the "institutional-grade" feel under load and should be on the immediate post-launch list.
