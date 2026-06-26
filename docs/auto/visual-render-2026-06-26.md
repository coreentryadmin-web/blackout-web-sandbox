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
- ⚠️ FLAGGED: `_rsc` prefetch-burst 503s (infra) via TaskCreate (#1).

---

## Live RTH data-integrity validation (user-requested mid-run — "validate every number across every tool; during RTH all crons run continuously")

Run extended at user's request to (a) confirm crons run continuously during RTH and (b) cross-validate live numbers across tools. Captured ~09:50–10:07 ET, market OPEN.

### Cron continuity during RTH — `/api/admin/cron-health` (13 jobs)
- **`market_hours_stale: 0`** — NO market-hours-critical job is stale. Fleet health 61/100, 9/13 healthy.
- System Vitals: **Database Connected · Polygon WS (index) Live · UW Socket (flow) Live · Options WS (Massive marks) Live** — realtime writers all up.
- RTH writers ticking continuously: **SPX Engine** (every 5min, 100%, tick 14:00 UTC), **UW Cache Refresh** (tick 14:02), **Heat Maps Warm**, **Night's Watch Warm** — all HEALTHY.
- ⚠️ **Flow Ingest** (every 2min RTH) = **WARNING**, 24h mix 33% (2 ok / 4 skip), "last run skipped" → Task #2. (Non-fatal: WS flow feed is Live, so HELIX renders; cron is the PG-persistence writer.)
- ❌ **Night Hawk Edition** = **FAILED** (tick Jun 25 23:32 UTC) — after-close job, consistent with the ::date crash fixed today in cc17d83 → Task #3 (verify recovery).
- GEX EOD Snapshot / GEX Regime Alerts = UNKNOWN/idle (EOD/conditional — expected intraday).

### Cross-tool number consistency (live, ~14:07 UTC)
| Check | Values | Verdict |
|---|---|---|
| SPX spot | desk 7352.37 == spx-quote 7352.37 == pulse ~7350.8 | ✅ agree |
| SPX change% self-consistency | desk −0.069% reconstructs from prior_close 7357.49 (−0.0696%) | ✅ internally correct |
| SPY spot | spy-quote 732.45 == heatmap 732.45 | ✅ agree |
| SPY×10 vs SPX | 7324.5 vs 7352.4 → SPY at 99.6% of SPX/10 | ✅ normal tracking |
| Max pain | SPY 739 ×10 = 7390 ≈ SPX dash 7385 | ✅ consistent, drifts live |
| VWAP/VIX | VWAP 7321 < spot 7352 ⇒ above_vwap true; VIX 19.27 | ✅ coherent |
| **SPX vs SPY day-change** | SPX **−0.069%** vs SPY **−0.25%** (~0.18% gap) | ⚠️ within-tool math correct on both; gap = SPY/SPX tracking basis (post-ex-div offset), plausibly legit but unverified vs external ref |

CONCLUSION: every tool's numbers are **internally consistent and cross-consistent** on the core market series (spot, change, max-pain, GEX levels, VWAP, VIX). The lone open question is the SPX↔SPY day-change basis gap (needs an external-reference check, not an obvious app bug). A FULL "every number, every tool" audit (HELIX net-premium/dark-pool/velocity, Largo quoted levels vs desk, Night's Watch valuations vs live marks, track-record math) is broader than one run → proposed as a recurring RTH data-integrity job (Task #4).

---

## SHIPPED (user-directed, full permission): recurring RTH data-integrity sweep — every 5 min, auto-open incidents

User asked for a recurring sweep ("every 5 minutes, and auto open incidents"). Built + shipped to main (tsc + clean `next build` green):
- **`src/lib/data-integrity-checks.ts`** — `runDataIntegrityChecks()` cross-validates, with WIDE bands + both-sides-fresh gating so it can't false-positive: C1 desk change% vs price/prior-close (±0.1%); C2 SPX spot desk-vs-heatmap (>0.5%); C3 SPY spot quote-vs-heatmap (>0.5%); C4 SPY×10/SPX tracking (>1.5%); C5 max-pain SPX vs SPY×10 (>2%); C6 GEX SPX/SPY freshness during RTH (>15m or cold). All `warning` severity in v1, category `data-integrity`, stable titles (numbers in detail) so each discrepancy = one upserting incident.
- **`src/app/api/cron/data-integrity/route.ts`** — cron route (CRON_SECRET auth, self-skips outside RTH + when market closed), auto-opens/resolves incidents. Kill-switch `DATA_INTEGRITY_INCIDENTS=0` (ON by default).
- **`src/lib/admin-incidents.ts`** + **`admin-spx-dashboard.ts`** — added a namespace-scoped reconcile (`resolveScope`) so the data-integrity cron and the SPX Operations dashboard share the `admin_incidents` table WITHOUT clobbering each other's incidents.
- **`src/lib/cron-registry.ts`** + **`railway.data-integrity.toml`** — registered "Data Integrity" job, schedule `*/5 11-21 * * 1-5`.

LIVE CALIBRATION (market open ~14:25 UTC): SPX heatmap available (spot 7362.54, 118 strikes); SPY×10 7338 vs SPX 7362 = −0.33% (band 1.5%); max-pain 7450 vs 7390 = 0.81% (band 2%); all asof current. → **zero discrepancies, zero false positives** on real data.

⚠️ TWO follow-ups:
1. **Commit-message mixup (concurrency collision):** a concurrent **api-integration-audit** job sharing the cron clone ran `git add -A` mid-edit and swept my 6 uncommitted data-integrity files into ITS commit **`49cb17d` "fix(api): cross-provider reliability hardening"** + pushed. Files are all correct on main and the COMBINED HEAD was re-validated green (tsc + build), but the feature is mislabeled in history. Root cause = the known shared-clone residual risk. → reinforces the need to serialize cron-clone git ops (Task: see #4 notes).
2. **Railway service still needs wiring:** the cron won't fire on schedule until a Railway cron service is created with config-as-code path `railway.data-integrity.toml` (+ CRON_SECRET). Until wired, admin will show "Data Integrity" as never-fired and the staleness watchdog may flag it (accurate). MANUAL Railway step.
