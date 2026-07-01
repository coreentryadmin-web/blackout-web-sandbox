# BlackOut Trades — Production Audit Report

**Prepared for:** Executive / Board
**Author:** CTO
**Date:** 2026-07-01, 07:20 UTC (03:20 ET) — market closed (pre-market)
**Site:** https://blackouttrades.com — Next.js 15 App Router · Clerk (live prod) · Whop billing
**Scope of run:** 25 audit units — data correctness, page/panel/button audits, authZ/middleware/gating, admin + market APIs, cron/scheduling, webhooks/billing, security/headers/CSP, design system, observability, shared components/a11y.

---

## 1. Executive Summary

This audit covered the production system end-to-end at the **HTTP + source-code + live-data-correctness** layers. Every check was performed against the real production deployment using an authenticated admin session over `curl` (the Clerk key authenticates against the live instance with ~21 real users) plus full source review.

**IMPORTANT — coverage limitation:** the **browser / visual / interactive / console / WebSocket layer was BLOCKED** by the audit environment. Chromium/Playwright could not connect to any HTTPS host (`net::ERR_CONNECTION_CLOSED`, both proxied and direct), while `curl` through the proxy worked. As a result, **nothing was verified by actually rendering a page in a browser** — no visual/layout confirmation, no client-side console errors, no live WebSocket behavior, no click-through of buttons. Findings about rendered output are asserted from the SSR HTML captures, computed CSS, and source, not from a live browser. This gap must be closed (Section 5).

**Overall posture:** the platform's *engineering fundamentals are strong*. AuthZ is consistent and fails closed (all 21 admin routes self-guard, all 23 cron routes use timing-safe secret checks, per-user routes are userId-scoped with no IDOR found, tier resolution never over-grants on outage). Rate limiters, caching architecture, error boundaries, the AI-spend kill switch, and the durable Postgres error sink are all well-built. Arithmetic across the data endpoints is overwhelmingly correct and internally consistent.

**The problems are concentrated in three places:**

1. **Outcome/grading correctness on the flagship track record** — profitable trades are being labelled losses, producing a **fabricated 0% win rate** and self-contradictory displays. This is the single most damaging finding because it corrupts the product's core social-proof metric.
2. **Wrong/dead classification labels shown to paying users** — the market-regime composite is permanently stuck on "NEUTRAL," VIX term structure is mislabeled, Top Movers renders a `+22,245%` garbage gainer, and a "paid — refresh access" button shows green success to non-payers.
3. **Silent operational blind spots** — both Discord ops webhooks are unset in production, so *all* push alerting is a no-op; and a DST scheduling bug will silently disable a Night Hawk cron every winter.

There are **no critical security/authZ holes** and no privilege-escalation paths in scope. One item originally flagged critical (Whop webhook idempotency) was downgraded to high after verifying the reconcile cron backstops the common case.

**Counts (verified):** 1 critical, ~13 high, ~18 medium, plus low/info. The critical and the highest-impact highs are all *data-correctness / customer-facing-trust* issues, not outages.

---

## 2. Top Risks

| # | Sev | Area | One-line | Location |
|---|-----|------|----------|----------|
| 1 | **Critical** | Data / track record | Profitable SPX plays graded as losses → public win rate shown as **0%** (real ~22%) | `src/lib/spx-play-outcomes.ts:170` (`classifyOutcome`) |
| 2 | High | Data / regime | Composite market regime is **always "NEUTRAL"** — consumer matches values producer never emits | `market-regime-detector/route.ts:51-73` vs `gamma-desk.ts:127-129` |
| 3 | High | Data / grid | Top Movers headline gainer is a garbage Polygon artifact: **"DISK +22,245.62%"** | `polygon.ts:315,322-326`; `GridMoversPanel.tsx:21` |
| 4 | High | Data / track record | Corrupt Night Hawk entry ranges (low=17) → **avg winner 44.3%, profit factor 738.87** | `track-record-page.ts:57-99` |
| 5 | High | Data / track record | "Stop" (loss) row shows **+5.25%** return; avg-loser clamp hides the misgrade | `track-record-page.ts:91-94` |
| 6 | High | Data / desk | VIX term structure mislabeled **"backwardation"** for a contango curve | `vix-term-utils.ts:44-62` |
| 7 | High | Billing / UX | "I paid — refresh access" shows **green success on FREE tier** (non-payer) | `SyncMembershipButton.tsx:19-27` |
| 8 | High | Billing / webhooks | Whop idempotency key set pre-processing, never cleared on 500 → dropped events (bounded by 6h reconcile) | `webhook/whop/route.ts:156,309-333` |
| 9 | High | Observability | **All ops alerting is a no-op** — both Discord webhooks unset in prod | `spx-play-notify.ts:59-70`; live `/api/admin/health` |
| 10 | High | Cron / DST | `nighthawk-morning-confirm` single-UTC fire → **silently never runs all winter (EST)** | `railway.nighthawk-morning-confirm.toml:23` |
| 11 | High | Content / pricing | FAQ advertises a **"lifetime" plan** the pricing UI and checkout don't offer | `FaqSection.tsx:95` vs `PricingSection.tsx:42-47` |
| 12 | High | Security / headers | `/embed/*` ships **`X-Frame-Options: SAMEORIGIN`** (CF edge) → breaks cross-origin embed | `next.config.mjs:50-56` vs live headers |

---

## 3. Data-Correctness Verdict

**Is every number correct and well-formed? No — but the failures are localized, and the arithmetic engine underneath is sound.**

### What was validated and is clean
Across GEX positioning/heatmap, indices, snapshots, grid endpoints, admin health/cron-health/telemetry, and the SPX aggregate math, the numbers recompute **exactly** to float precision:
- GEX: `put_wall 735 < flip 740.63 < spot 746.77 < call_wall 750`; all four totals (net_gex 3.06e9, net_vex 4.48e10, net_dex −7.63e9, net_charm −6.14e11) equal the sum of near-term cells; postures match signs; positioning ↔ heatmap agree on all 11 shared quantities.
- Cross-endpoint spot agreement is perfect: SPY 746.77 / +0.78% and SPX 7499.36 / +0.79% (~10× ratio), VIX ~17.1, consistent everywhere.
- Grid: dark-pool premium = size×price for all 20 prints; economy change_pct recomputes for all 7 indicators; earnings/news well-formed.
- Admin: cron-health 23 jobs all consistent (every age_min, every meta sum ties out); errors feed 100 contiguous well-formed events; market/health telemetry internally airtight (provider calls sum to totals, p95/p99 ≤ max, no NaN/Inf).
- No `NaN`/`Infinity`/`null`-in-number-slot in the vast majority of payloads; timestamps well-formed.

### The 0% win-rate — the headline correctness failure (CRITICAL)
`/api/public/track-record` reports `total_closed=9, wins=0, losses=9, win_rate_pct=0`. **This is factually wrong, not a small-sample artifact.** `classifyOutcome` (`spx-play-outcomes.ts:170`) returns `"loss"` for *any* `exit_action === "THESIS"` **before** the realized-P&L fallback branch runs. Two live rows are genuinely profitable and still graded loss:
- id 3: long, entry 7432.13 → exit 7439.43, **pnl +7.30 pts**, grade A+, THESIS → "loss"
- id 7: long, entry 7491.08 → exit 7493.92, **pnl +2.84 pts**, grade B, THESIS → "loss"

The +2.84 row would even satisfy the code's own `pnl_pts >= 2 ⇒ win` branch if THESIS didn't short-circuit it. Real win rate is **≥ 2/9 ≈ 22%**. The per-play table (`PlayHistoryTable.tsx:52-99`) renders these as **green "+7.3"/"+2.8" next to a red "L"** — a self-contradiction. (Note: these track-record surfaces are admin-gated today — the "public social proof" framing is aspirational; the numbers themselves are still wrong and feed internal win-rate/adaptive-gate logic.)

### Other malformed / inconsistent numbers shown to users
- **Top Movers "DISK +22,245.62%"** (and "JEM +835.19%"): raw Polygon `todaysChangePerc` passed through with no ceiling; `isClean` filters price<$1/warrants/low-volume but not `change_pct`; sorted to #1 by `|change_pct|`. Rendered verbatim. (`polygon.ts:315`, `GridMoversPanel.tsx:21`) — public-facing on `/grid`.
- **Night Hawk avg winner 44.3% / profit factor 738.87**: two rows carry corrupt `entry_range_low=17` (MRK 17–114.36, OKTA 17–115; target/stop ~109–122 prove true entry ~114). Midpoints skew to +97%/+99% returns; excluding them, avg winner ≈ 8.5%. (`track-record-page.ts:57-99`) — admin-only surface.
- **"Stop" loss row shows +5.25%**: AMAT (id 1) graded `stop` but `next_day_close 694.64` is above entry high and target → +5.25%; the loser set raw mean +... is masked by `Math.min(0, …)` clamp to −0.1%. (`track-record-page.ts:91-94`)
- **VIX "backwardation" on a contango curve**: `computeVixTermStructure` compares near-vs-**spot** instead of near-vs-far. Live desk: vix9d 13.73 < spot 17.17 < vix3m 19 (contango) labelled "backwardation." The app's own signal engine (`spx-signals.ts:536-554`) correctly calls the *same* data "VIX contango" — a direct internal contradiction. (`vix-term-utils.ts:44-62`)
- **Float noise**: SPX Overview hero renders `7499.360000000001` (no `toFixed`, `AdminSpxDashboard.tsx:110`); Night Hawk IV rank renders `IV 76.2564` beside a clean `IV 100` (`PlaybookPlayRow.tsx:118`); public per-play API ships 14-digit float-noise P&L.
- **`ageMs` = ~56 years**: polygon index WS status computes `Date.now() - 0` when never ticked; surfaces `1782890248688` in three admin endpoints (`polygon-socket.ts:517`).
- **APIs dashboard self-contradiction**: summary says `calls_window:0 / providers_healthy:0/4` while its own cluster block reports 61 live calls (`admin-api-dashboard.ts:362-364`).
- **Mislabeled bands**: signal-analytics "45-52" band actually contains all scores < 52 including negatives (avg 27.3); Congress party dots always neutral (UW returns chamber, not party).

### What CANNOT be validated off-hours (not defects)
Market is closed, so these empty/stale states are **expected and correct behavior**, not bugs: `available:false` on `/api/market/spx/flow|play|pulse`; `/api/nighthawk/play-status` 404 (morning-confirm cron fires 9:15 ET); 11 "info" WS-disconnect issues in admin health; slow cold-cache endpoints (grid/bootstrap 7.6s etc.) because warm crons are `market_hours_only`; the regime snapshot being ~11h old.

---

## 4. Findings by Area

### 4.1 Data correctness (see Section 3 for the numeric detail)
- **CRITICAL** — THESIS exits graded loss regardless of P&L → 0% win rate. `spx-play-outcomes.ts:170`.
- **HIGH** — Composite regime permanently "NEUTRAL": `deriveComposite` tests `g==="long"/"short"` but producer `gammaRegime` only emits `"mean_revert"/"amplification"/"unknown"`; all 6 rich composites + playbooks are dead code. Live `/api/market/regime` and `/api/platform/intel` confirm stuck NEUTRAL. `market-regime-detector/route.ts:51-73,194`.
- **HIGH** — VIX term-structure mislabel (backwardation vs contango). `vix-term-utils.ts:44-62`.
- **HIGH** — Top Movers garbage gainer. `polygon.ts:315`.
- **HIGH** — Night Hawk corrupt entry ranges inflate aggregates. `track-record-page.ts:57-99`.
- **HIGH** — Night Hawk "stop" loser shows positive return, clamp masks it. `track-record-page.ts:91-94`.
- **MEDIUM** — Float noise (SPX hero price, IV rank, per-play P&L); 56-year `ageMs`; APIs-dashboard 0-vs-61 contradiction; "45-52" band label; Congress party dots dead; DIVERGE flow badge permanently dead (0/500 rows).

### 4.2 Pages / panels / buttons / content
- **HIGH** — FAQ advertises "lifetime" access; pricing toggle and checkout only offer monthly/yearly (lifetime commented out, Whop $2,500 cap). `FaqSection.tsx:95`.
- **MEDIUM** — Hero "See pricing" is a dead anchor inside the iOS app (target section `display:none` via `hide-in-ios-app`); also re-introduces a pricing entry point App Store gating exists to remove. `HeroSection.tsx:103`.
- **MEDIUM** — `/embed/track-record` generic `<title>` (no metadata export); copy-paste iframe snippet `height=200` clips a >300px card; Night Hawk shows raw tiny-sample stats while SPX is gated behind "Collecting data"; three `/learn/*` client pages fall back to generic title; Night Hawk mobile TOC "Key Features" anchor points to a non-existent section; inconsistent guide prev/next nav.
- **LOW/INFO** — footer omits BlackOut Grid; heatmap flip-divider double-"γ" label; Largo header double nav-offset padding cramps chat area on short viewports.

### 4.3 AuthZ / security / headers
**Posture is strong.** All 21 admin routes self-guard (`requireAdminApi`); all 23 cron routes use `isCronAuthorized` (constant-time, fail-closed); per-user routes are userId-scoped (no IDOR); tier resolution fails closed; webhooks verify HMAC/svix. `/api/signals/open` 401 and `/api/market/largo/session` 400 are **correct** (cron-secret-only, and missing-param respectively) — not bugs.
- **HIGH** — `/embed/*` serves `X-Frame-Options: SAMEORIGIN` (injected by Cloudflare) despite `next.config.mjs` deliberately stripping it and relaxing CSP to `frame-ancestors *` — breaks the cross-origin embed feature in XFO-honoring browsers. `next.config.mjs:50-56` vs live headers.
- **MEDIUM** — Cloudflare overrides origin security headers: HSTS max-age halved (63072000→31536000), `payment=()` dropped from Permissions-Policy → `next.config.mjs` is not the source of truth.
- **MEDIUM** — CSP allows `'unsafe-inline'` + `'unsafe-eval'` in script-src and unrestricted `connect-src https: wss:` → weak XSS/exfil mitigation.
- **MEDIUM** — State-mutating GET: `/api/admin/spx/dashboard?live=1&dryRun=false` fires live subscriber Discord alerts and advances engine state on an idempotent GET (admin-gated, defaults safe, but CSRF-shaped and bypasses the POST-only mutation backstop). `admin-spx-dashboard.ts:204`.

### 4.4 APIs / performance
- **MEDIUM** — SPX desk cache-key fragmentation: live dashboard routes read bare keys (`spx-desk`) but the warm cron populates date-suffixed keys (`spx-desk:${date}`) → during market hours the dashboard bypasses the warm cache and duplicates UW (2-RPS) + Polygon load; also misses the midnight-session fix. `spx/desk/route.ts:19` vs `spx-desk-loader.ts:27-29`.
- **MEDIUM** — `buildSpxDesk` issues ~12 strictly-serial UW calls (two `runUwSequential` blocks) on the cold path → ≥3.6s of pure inter-call spacing; should use `runUwPool(3)`. `spx-desk.ts:1045-1057,1156-1164`.
- Slow off-hours endpoints are expected (cold cache, market-hours-only warmers).

### 4.5 Billing / webhooks / membership
- **HIGH** — Whop idempotency mark-then-500: dedup key set before handler (`route.ts:156`), never cleared on the 500 path (no `redis.del` anywhere) → first retry after any transient throw is acked as duplicate and the event is dropped. Backstopped by the 6h reconcile cron (heals email-resolvable memberships both directions) and by `markMembershipRevoked` persisting the denylist before the throwing sync, so blast radius is bounded — downgraded from critical to high. Truly-permanent loss is limited to non-email-resolvable memberships.
- **HIGH** — "I paid — refresh access" green success on FREE tier: `/api/membership/sync` returns 200 for all non-error outcomes; button only branches on `!res.ok`, so a non-payer sees "✓ Access granted — FREE. Floor is open." in green on the public `/upgrade` recovery path. Does not grant access (entitlements stay correct), but misleads on a money path. `SyncMembershipButton.tsx:19-27`.
- **MEDIUM** — No `user.deleted` Clerk handler → orphaned PII rows (email, name) indefinitely (GDPR retention). `webhooks/clerk/route.ts:49-78`.
- **MEDIUM** — Refund/dispute revocation denylist is Redis-only and fail-open → premium re-grants if Redis is unavailable during reconcile (revenue leak). `whop-revocation.ts:16-25`.

### 4.6 Design system / fonts
Fonts are healthy (all 4 families self-hosted, `display:swap`, preloaded, no FOUT/CLS).
- **MEDIUM** — `.largo-pipeline-dot` references undefined `--grey-700` with no fallback → pending pipeline dots render invisible in the Largo terminal thinking state. `globals.css` (`.largo-pipeline-dot`).
- **MEDIUM** — Token drift: two cyans for the same role (`#22d3ee` token vs `#00d4ff` glows in 41 places); competing greens; a "kill on sight" animated scan-line still renders on `/embed/track-record`; brand-guard script only inspects class names so raw grey hex slips through.

### 4.7 Observability / alerting
- **HIGH** — All Discord ops alerting is a silent no-op: live `/api/admin/health` shows `discord_ops_webhook=false` AND `discord_play_webhook=false`; `notifyOpsDiscord` falls back ops→play and, with both unset, logs "DROPPED" to stderr and returns false. Every alert caller is inert — cron failures, the market-hours cron-death watchdog (the exact #90 outage it was built for), the $50 AI-spend threshold, unhandled rejections, Whop 500s, SPX criticals. Push alerting is dead; code is correct, only `DISCORD_OPS_WEBHOOK_URL` is missing. (Durable Postgres error sink + Sentry-when-DSN-set do capture request/rejection errors, so it is not *total* blindness — but the operationally critical paths use Discord exclusively.) `spx-play-notify.ts:59-70`.
- **HIGH** — DST cron bug: `nighthawk-morning-confirm` fires at a single `15 13 * * 1-5` UTC → 09:15 ET in EDT (in its 9:10–9:45 self-skip window) but 08:15 ET in EST (out of window) → silently self-skips every winter weekday for ~5 months; play-status badges never written, INVALIDATED alerts never fire; watchdog only alerts on stale/failed, not skipped, so it's invisible. Sibling crons already got the dual-band fix (`15 13,14`). Latent now (EDT), breaks at fall-back. `railway.nighthawk-morning-confirm.toml:23`.
- Note: AI-spend kill switch fires with only `console.warn` and no alert; Sentry is installed but not wired (no `withSentryConfig`, no client capture).

### 4.8 Accessibility / shared components
Component library is high quality: proper WAI-ARIA tabs with roving tabindex, hand-rolled focus trap + scroll-lock + return-focus, keyboard handling on clickable non-buttons, aria-hidden decoratives, skip-to-content link, correct image alt handling. No NaN leaked into crawled HTML.
- **MEDIUM** — Shared formatters in `src/lib/api.ts` (`fmtPremium`/`fmtPct`/`fmtPrice`) guard null/undefined but **not NaN** → a NaN input renders "$NaN" / "NaN%" (used pervasively by desk components).
- **MEDIUM** — ~24 dead/unreferenced component files (~1,800 lines, incl. a dead embeds subtree and recharts/framer-heavy `DnaHelixBackground`); a few presentational components carry unnecessary `"use client"`.
- **Not verifiable off-browser:** runtime contrast, focus-visible rendering, screen-reader behavior (env blocked the browser).

---

## 5. NOT Covered — Needs the Browser (blocked this run)

The Chromium/Playwright network block means the entire **client-runtime layer was not exercised**. Once the network policy is fixed, re-run with a real browser to cover:
- **Visual/layout**: confirm the flagged CSS issues actually render as described — invisible Largo pipeline dots, Largo header double-offset cramping, embed iframe `height=200` clipping, cyan/green token mismatches, the scan-line anti-pattern, the SPX hero float-noise and `IV 76.2564` as *rendered* (not just source).
- **Console/JS errors**: client-side exceptions, hydration mismatches, `$NaN`/`NaN%` from the unguarded formatters, the green "Access granted — FREE" message and `session.reload()` behavior on `/upgrade`.
- **Interactive**: click every CTA/button — "See pricing" dead anchor in iOS shell, "Copy snippet," "I paid — refresh access," Congress party dots, the DIVERGE flow badge, dead TOC anchors, prev/next guide nav.
- **WebSockets during market hours**: live pulse SSE (duplicate connections flagged), Polygon index WS freshness/`ageMs` under a real tick, and whether the market-hours-only warm crons + cache-key fragmentation actually degrade freshness under load.
- **Cross-origin embed**: load `/embed/track-record` inside a third-party `<iframe>` to confirm `X-Frame-Options: SAMEORIGIN` blocks it.
- **Screen-reader / contrast / focus-visible** a11y at runtime.

---

## 6. Prioritized Remediation Checklist

**P0 — fix now (customer-facing correctness / trust)**
1. `spx-play-outcomes.ts:170` — stop grading positive-P&L THESIS exits as losses; grade by realized P&L (`>=2 ⇒ win`, `<=-1 ⇒ loss`, else breakeven). Backfill ids 3 & 7; add a regression test.
2. `track-record-page.ts` — add a sanity guard dropping rows with implausible entry-range ratio (high/low > 2); fix the two `low=17` rows; treat a positive clamped avg-loser as a health alert, not a floor. Fix the "stop" row that returns +5.25%.
3. `polygon.ts` `isClean` — cap `|change_pct|` (e.g. > 300–500%) or validate against `(price-prevDay.c)/prevDay.c`; drop the DISK/JEM artifacts.

**P1 — fix this week (wrong labels / dead features / money path)**
4. `market-regime-detector/route.ts` `deriveComposite` — map the real vocabulary (`mean_revert`→long-γ, `amplification`→short-γ); add tests for the 6 composites.
5. `vix-term-utils.ts` — classify from near-vs-far slope (align with `spx-signals.ts`); add a `(17,13.73,19) ⇒ contango` test.
6. `SyncMembershipButton.tsx` — branch on returned tier; only show green success when `tier==="premium"`; show a neutral "no active membership" state otherwise.
7. `webhook/whop/route.ts` — mark idempotency *after* success, or `redis.del` the key on the 500 path before returning.
8. **Set `DISCORD_OPS_WEBHOOK_URL`** (and a fallback) in production — restores all ops alerting; surface `discord_ops_webhook===false` as a health WARNING.
9. `railway.nighthawk-morning-confirm.toml` — change schedule to `15 13,14 * * 1-5` (dual-band) so it fires in-window in both EDT and EST; add an EST/EDT window test.
10. `FaqSection.tsx:95` — change FAQ copy to "monthly or yearly" until lifetime is re-enabled; derive wording from `PricingSection.TERMS`.
11. `/embed/*` — remove the Cloudflare-injected `X-Frame-Options` via a CDN Transform Rule so cross-origin framing works.

**P2 — fix this sprint (polish / hygiene / hardening)**
12. Round/format displayed numbers: SPX hero `toFixed(2)`, IV rank `Math.round`, per-play P&L; guard `ageMs` for `updatedAt===0`; base APIs-dashboard summary on the cluster rollup; rename the "45-52" band; fix Congress dot semantics.
13. Consolidate SPX desk cache keys (routes ↔ cron) and parallelize `buildSpxDesk` UW calls with `runUwPool(3)`.
14. Add Clerk `user.deleted` handler; persist Whop revocations to Postgres (Redis as hot cache only) and alert on fail-open.
15. Consolidate security-header ownership (Cloudflare vs next.config); tighten CSP (nonce-based script-src, scoped connect-src) as a follow-up.
16. Move the live-mutation SPX dashboard trigger to POST with a server-verified confirmation token.
17. Define `--grey-700` (or replace with a literal); reconcile cyan/green tokens; remove the scan-line; delete dead components; add NaN guards to `fmtPremium`/`fmtPct`/`fmtPrice`.
18. Fix `/embed` metadata/title, iframe snippet height, `/learn` client-page titles, dead TOC anchor, guide nav consistency, footer Grid link, Largo header padding.

**P0-infra — unblock verification**
19. Fix the audit environment network policy so a real browser can reach production, then re-run the full client-runtime + visual + WebSocket audit (Section 5) before signing off these fixes.
