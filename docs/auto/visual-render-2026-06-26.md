# visual-render-sweep — 2026-06-26

Run start: 2026-06-26T06:43 PT (≈09:43 ET — **market OPEN / RTH**, so live data expected; all-"—" during RTH treated as a potential bug, not an expected empty state).
Bridge: Chrome (blackouttrades.com), signed in as admin.

## Page sweep (screenshot + console + network per page)

| Page | Render | Console | Notes |
|---|---|---|---|
| `/` | ✅ clean | clean | Hero, THE ARSENAL (6 instrument cards), ticker marquee, pricing, footer all render; brand colors correct; no grey. |
| `/dashboard` (SPX Slayer) | ✅ clean | clean | Slow first paint (~8s) then fully live: price 7,321.13, EMA/SMA/SESSION, ticker chips, GEX walls, Largo Live intel. |
| `/flows` (HELIX) | ✅ clean | ⚠️ Clerk mount (see below) | "OFFLINE"+skeleton for ~12s (WS connecting) → "AI BRIEF · LIVE": tape, NET PREMIUM, VELOCITY RADAR, HAWK CONVICTION populated. |
| `/heatmap` | ✅ clean | clean | **Slow** first paint (~18-20s, OFFLINE→LIVE) then full GEX matrix + KEY LEVELS (GAMMA FLIP 733 / CALL WALL 758 / PUT WALL 738 / MAX PAIN 736 / NET GEX -$7.5B). `/api/market/gex-heatmap` 200 with fresh data. Slow-render = perf-audit domain, not a render bug. |
| `/nighthawk` | ✅ clean | clean | "PLAYBOOK PENDING — setups publish after the cash close ~5:30 PM ET" = **correct** market-open empty state. NIGHT'S WATCH add-position form renders. |
| `/terminal` (Largo) | ✅ clean | clean | "AI ONLINE", greeting, input + DEPLOY render. |
| `/upgrade` | ✅ clean | clean | Pricing ($199/$1,999), FREE-vs-PREMIUM table ("—" in FREE col = intentional not-included marker, not a data bug). |
| `/embed/track-record` | ✅ clean | clean | "STANDBY", 0 WINS/0 LOSSES/0 SCRATCH, "Play log warming up…" = correct early-session empty state. |
| `/admin` | ✅ clean | clean | Operations center, 0 incidents (correct), AVG MTTA "—" (correct empty metric), SYSTEM VITALS + AUDIT TRAIL. |

**No** broken layouts, overlaps, all-"—" data bugs, broken images, or grey-color violations found. All empty states correct for market-open.

## Cross-cutting findings

### 1. `[Clerk UI] Component renderer did not mount within 10s` — FIXED (mitigation → main)
- **Evidence:** fired 2× at one timestamp on a cold `/flows` full-load; did not recur on warm soft-navs. Clerk's `<UserButton>` (src/components/Nav.tsx:332/400) renders once `useAuth()` hydrates; its renderer depends on `clerk-js` + `@clerk/ui` chunks loaded from `clerk.blackouttrades.com` (a separate origin — those requests were observed "pending" during the slow window). The watchdog trips when those cross-origin chunks load slowly on a cold connection. Benign (avatar renders once chunks land) but is a real console error.
- **Fix:** added `<link rel="preconnect">` + `<link rel="dns-prefetch">` for `https://clerk.blackouttrades.com` to the root `<head>` (src/app/layout.tsx) so the Clerk origin handshake happens during HTML parse instead of after hydration. Clerk-recommended, behavior-neutral (no-op if unused), tsc + build green. This is a **mitigation** (reduces cold-load flakiness), not a proven elimination — re-check next run.

### 2. `_rsc` prefetch 503s on dynamic routes — FLAGGED (infra, not a confident code fix)
- **Evidence:** on every page load, the Next `<Link>` prefetch burst for `/sign-up /dashboard /flows /heatmap /terminal /nighthawk` returns `?_rsc=…` **503**. BUT fetching those same `_rsc` URLs **one at a time** (with RSC headers) returns **200** with valid RSC payloads. So routes are healthy; the 503s only occur under the simultaneous prefetch burst → points to Cloudflare/origin **burst rate-limiting of prefetch requests**, an infra/config concern. UX unaffected (full navigations work; failed prefetches fall back to on-demand). `server: cloudflare`, `cf-cache-status: DYNAMIC`.
- **Why flag not fix:** root cause is edge/infra (Cloudflare rule or Railway concurrency), not clearly in-repo; the in-repo candidate (set `prefetch={false}` on heavy dynamic nav `<Link>`s to kill the burst) is a perf/UX tradeoff = a product call. Flagged for human review.

### 3. `cloudflareinsights` beacon 503 — IGNORED (third-party)
- `static.cloudflareinsights.com/beacon.min.js` returns 503. Cloudflare's own analytics beacon, not our app, transient. No action.

## Actions
- ✅ FIXED → main: Clerk preconnect/dns-prefetch hint (src/app/layout.tsx). tsc + build green.
- ⚠️ FLAGGED: `_rsc` prefetch-burst 503s (infra) via TaskCreate.
