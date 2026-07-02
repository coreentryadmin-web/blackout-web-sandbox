# BlackOut Trades — Audit Findings (living doc)

Verified issues from the production data-correctness audit. Newest/most-severe first.
Cross-provider ground truth: Polygon + Unusual Whales REST. Started 2026-07-01.

**Merge policy for this doc's PRs:** left OPEN for end-of-day review — do not merge without explicit go-ahead, even when CI is green.

---

## 🟢 FIXED — `provider-health-reconcile` cron intermittent PgBouncer `server_login_retry` failures (ops #242)
**Status:** FIXED (`cursor/provider-health-reconcile-0fcb`).

**Where:** `dbQuery()` in `src/lib/db.ts` — no retry on transient PgBouncer login blips. `provider-health-reconcile` (and other crons) logged `failed` rows when PgBouncer briefly returned `server login has been failing, cached error: connect failed (server_login_retry)`. `hit-cron.mjs` HTTP retries amplified this into 3–4 failed `cron_job_runs` rows per scheduled tick before one `ok`.

**Evidence:** Postgres `cron_job_runs` 2026-07-02 — 9/90 provider-health-reconcile runs in 24h failed, all with the same PgBouncer message; latest run `ok` at 13:10:35Z after transient blip at 13:10:16–25Z. Ops collect fingerprint `7dcb62ad3be6` cleared once latest run recovered.

**Fix:** `isTransientPgError()` in `src/lib/db-transient.ts`; `dbQuery()` retries up to 3× with pool reset + backoff on transient errors (configurable via `PG_QUERY_RETRIES` / `PG_QUERY_RETRY_DELAY_MS`).

**Verification:** 5 unit tests in `db-transient.test.ts`; `npx tsc --noEmit` clean.

---

## 🔴 CRITICAL — FIXED — `/api/market/gex-heatmap`'s cross-validation call site never got the near-term expiry scope fix from PR #223 — the SPX matrix's "UW oracle diverges Npt" banner has been showing scope-mismatch-inflated divergence this whole time
**Status:** FIXED (`fix/gex-heatmap-cross-validation-scope`). Found while investigating a live user report of the banner reading "diverges 600pt" on the SPX matrix.

**Where:** `src/app/api/market/gex-heatmap/route.ts:292-300`. PR #223 (earlier today) fixed the scope-mismatch bug by threading `nearTermExpiries` through `gex-positioning.ts`'s call to `validateGexAgainstUW()` — but there is a SECOND call site, in this route, that feeds `cross_validation` directly into the `/api/market/gex-heatmap` response. **This second call site was never touched** — it called `validateGexAgainstUW(ticker, {...}, { spot: heatmap.spot })` with no `nearTermExpiries` at all, so it kept comparing Polygon's near-term-only walls (`NEAR_TERM_EXPIRY_COUNT=8`) against UW's all-expiries-summed ladder, reproducing the exact original bug on every single poll.

**This is the call site that actually feeds the visible banner.** `SpxGexMatrixHeatmap.tsx` reads `data.cross_validation` from `/api/market/gex-heatmap` (the unscoped one), NOT from `gex-positioning.ts`'s properly-scoped result. So the "PR #223 fix" that FINDINGS.md previously marked FIXED never reached the actual UI banner users see — it only fixed a sibling numeric field on a different endpoint (`/api/market/gex-positioning`) that isn't what renders the warning.

**Evidence:** live-probed both endpoints within the same minute (2026-07-01 ~19:18 UTC, spot ~7502): `gex-positioning` (scoped) → `callWallMatch: true, putWallMatch: false, flipMatch: true, divergence: 200`. `gex-heatmap` (unscoped, THIS bug) → `callWallMatch: false, putWallMatch: false, flipMatch: false, divergence: 200` — every level mismatching on the unscoped path vs. only one on the scoped path, for the identical moment. The user's screenshot moments earlier showed 600pt on the matrix banner — consistent with this same unscoped comparison spiking higher as the UW ladder's far-dated OI shifts.

**Fix:** added `const nearTermExpiries = heatmap.expiries?.slice(0, 8);` and threaded it into the `validateGexAgainstUW()` call in `gex-heatmap/route.ts`, mirroring `gex-positioning.ts` exactly (`heatmap.expiries` is the same ascending near-term-then-far-dated axis both call sites share).

**Second, related gap closed in the same PR:** while re-reading `gex-cross-validation.ts`'s own code comments, found the REST fallback path (used when UW's WebSocket channel goes stale) was flagged as "not yet expiry-scoped, unverified response shape" — verified live against the real UW API today:
- `/spot-exposures/strike` (currently used) returns ONE row per strike **already summed across every expiry server-side** — there is no per-expiry field to filter on after the fact. Structurally unscoped, not just "not yet" scoped.
- `/spot-exposures/expiry-strike` (UW's other endpoint, used elsewhere for 0DTE) DOES carry a per-row `expiry` field, but its `expirations[]` filter only honors ONE value even when several are passed (tested: 3 values → only the last one's rows came back), and unfiltered it caps at 50 rows that don't reliably cover the needed strike band (tested: 50 unfiltered rows for the 0DTE expiry covered strikes 7620-9800 only — the entire near-the-money/put-wall region below spot was missing).
- Neither endpoint can produce a properly-scoped ladder without N sequential per-expiry calls against a documented-flaky, rate-limited API, for a fallback path that's supposed to be rare and cheap. Running it unscoped when scoping is required would reintroduce the exact same false-positive bug intermittently (whenever WS goes stale) instead of always — worse than skipping the check that one time. `getUwStrikeLadder()` now returns `null` (skip the check) instead of an unscoped ladder whenever the caller requires scoping — extracted as `restFallbackAllowed()` in `gex-cross-validation-core.ts` for direct unit testing.

**Blast radius:** only these two call sites exist for `validateGexAgainstUW()` in the whole codebase (verified via grep) — both are now scoped.

**What was deliberately left unchanged:** `crossValidateGexLevels()`'s comparison logic itself (sign-aware extrema matching, ±2 strike tolerance) — untouched, it was never the problem.

**Verification:** `npx tsc --noEmit` clean; full suite passing (3 new tests for `restFallbackAllowed` in `gex-cross-validation-core.test.ts`); `next build` clean; live-reproduced the bug on both endpoints before fixing, per the Evidence section above.

## 🟢 FIXED — Redundant `ensureSchema()` calls duplicated across 11 files (20 call sites) ahead of `db.ts` helpers that already self-guard
**Status:** FIXED (`fix/api-telemetry-redundant-schema-check`).

**Where:** Started from a specific report — `[api-telemetry-persist] Error: Query read timeout` firing 4x right after a fresh deploy's replicas booted (Railway logs, 2026-07-01 ~18:38-18:41 UTC). `persistApiTelemetryEvent()`/`fetchPersistedApiEvent()` in `src/lib/api-telemetry-persist.ts` called `await ensureSchema();` immediately before `await dbQuery(...)` — but `dbQuery()` (`src/lib/db.ts`) already calls `ensureSchema()` as its own first line. Checking the rest of the codebase for the same pattern (blast-radius sweep per this doc's PR policy) found it duplicated in **10 more files, 18 more call sites**: `spx-play-outcomes.ts` (4x), `largo-store.ts` (3x), `error-sink.ts` (3x), `journal-store.ts` (2x), `spx-play-store.ts`, `spx-signal-log.ts`, `provider-health-reconcile.ts`, `admin-audit.ts`, `admin-spx-analytics.ts`, `app/api/admin/audit-log/route.ts` (1x each) — every one immediately preceding either `dbQuery()` or an exported `db.ts` function (`insertPlayOutcomeEntry`, `fetchOpenSpxPlay`, `upsertUserJournalEntry`, etc.) that already starts with its own `await ensureSchema();`.

**Root cause of the timeout, and why this fix does NOT claim to resolve it:** `ensureSchema()` is memoized via a shared `schemaReady` promise, so calling it twice back-to-back costs nothing once resolved — the redundant calls are dead weight, not a multiplier on lock-contention risk. Removing them is a correct, safe cleanup, but it is **not** the root cause of the timeout bursts. Attempted to find the real cause with a user-approved, read-only production DB probe (row counts, `pg_stat_activity`, advisory locks) — the probe itself failed at the network layer: this sandbox blocks raw Postgres TCP the same way it blocks WebSockets (confirmed via a direct `/dev/tcp` connect test and via the `pg` client hard-timing-out on the public endpoint; documented in `CLAUDE.md`'s Environment realities). The likely real cause — multiple replicas racing Postgres's migration advisory lock (`MIGRATION_LOCK_ID`) during a multi-replica cold boot, with `pg`'s client-side `query_timeout` (35s) as the backstop that ultimately fires — remains **open**, and needs either a Railway-side shell/exec or a temporary HTTP debug endpoint to properly root-cause with live lock/query state.

**Fix:** deleted all 20 redundant `await ensureSchema();` calls and their now-unused `ensureSchema` imports (10 files touched beyond the telemetry one). No behavior change — every code path still gets exactly one `ensureSchema()` call, just from the `db.ts` helper it was always going to call, not duplicated by the caller.

**What was deliberately left unchanged:** `ensureSchema()`/`runMigrations()`'s own internals (the advisory-lock acquire/release, the unconditional `spx_signal_log` dedup DELETE that runs on every cold boot) — changing lock/retry semantics without live lock-state evidence would be guessing, not fixing.

**Verification:** `npx tsc --noEmit` clean; full suite `574/574`; `next build` clean.

## 🟢 FIXED — SPX GEX heatmap chain still truncating at the (already-raised) 40-page guard — walls/OI/IV understated, likely driving oversized cross-validation divergence
**Status:** FIXED (`fix/gex-heatmap-chain-truncation`). Previously flagged as Cursor's file per this session's coordination boundary; the user explicitly asked for it to be fixed directly on 2026-07-01, superseding that boundary.

**Where:** `fetchHeatmapBand()` in `src/lib/providers/polygon-options-gex.ts:1168-1200`. `HEATMAP_PAGE_GUARD` (line 1154) was already raised **16 → 40** in an earlier fix this session specifically because SPX's full ±6%-band chain across ~8 expiries was overflowing the old 16-page cap (250 contracts/page). Live production logs (captured 2026-07-01 ~17:11-17:14 UTC, post-#217 deploy, and again ~18:38-18:41 UTC post a later deploy) show it now overflowing 40 pages too:
```
[polygon-gex] fetchHeatmapBand(I:SPX) truncated: hit 40-page guard with next_url still set — chain incomplete, walls/OI/IV understated. Raise the page guard or paginate fully if this recurs.
```
Firing repeatedly (multiple times per minute) — not a one-off. `fetchPolygonOiByExpiry` hit its 12-page guard too, for at least AMD (out of scope for this fix — different call site, `NEAR_TERM_EXPIRY_COUNT`-scoped, not implicated in the pasted logs).

**Root cause:** every previous fix to this line picked a static page count sized to fit the chain "as measured that day" (16 → 40). SPX's banded options chain grows as more weekly/monthly expiries populate and OI builds, so a static cap is a moving target — the 16→40 bump bought less than a day before truncating again. Fixing the *number* again would just recur on the same slower clock.

**Evidence:** paginated the live Polygon chain directly (same params as `fetchHeatmapBand`: `±6%` band around spot 7497.17, `strike_price.gte/lte`, `limit=250`) outside the app's rate limiter and measured the true chain size: **46 pages / 11,254 contracts** to exhaust `next_url` — 6 pages past the 40-page guard that was truncating it.

**Fix:** stopped chasing the live size with another static number. `HEATMAP_PAGE_GUARD` is now a generous **safety backstop** (200 pages, ~4x today's measured need) rather than a tuned-to-fit cap — the pagination loop already followed `next_url` correctly and was never the bug; only the stop condition was too tight. Floored at 40 (the old cap already proven insufficient) so a misconfigured/blank `OPTIONS_HEATMAP_PAGE_GUARD` env value can't reintroduce the original truncation. Extracted the floor/default math into an exported pure function `resolveHeatmapPageGuard()` so it's unit-testable without mocking network calls (`polygon-options-gex.test.ts`, 5 cases: default-200, blank/non-numeric env, larger override, floor-at-40, and the falsy-`"0"`-env edge case which is pre-existing `||` behavior, not new).

**What was deliberately left unchanged:** the pagination loop mechanism itself (`while (page && guard < HEATMAP_PAGE_GUARD)`), `warnChainTruncated()`'s observability logging (kept as a backstop-hit alarm — should now be rare/anomalous rather than routine), and `fetchChainBand`/`fetchPolygonOiByExpiry`'s own separate, smaller guards (different call sites, single-expiry scoped, not implicated by the pasted logs — raising those without matching live evidence would be an unverified guess).

**Verification:** `npx tsc --noEmit` clean; full suite `574/574` passing; `next build` clean; live Polygon pagination re-confirmed the 46-page chain size that motivated the new 200-page backstop.

## 🟢 FIXED — `gex_cross_validation`'s UW oracle compares ALL-expiries-combined walls against Polygon's deliberately NEAR-TERM-ONLY walls — a structural scope mismatch, not (only) a data-completeness bug
**Status:** CONFIRMED via independent multi-agent code trace (2026-07-01) → **FIXED in PR #223** (`fix/gex-cross-validation-expiry-scope`, draft, 5 new regression tests, 567/567 suite pass). Root-caused in response to a member-visible "UW oracle diverges 550pt from Polygon walls — treat levels as provisional until channels agree" banner on the live SPX Slayer matrix.

**The comparison itself (`crossValidateGexLevels`, `src/lib/providers/gex-cross-validation-core.ts:72-98`) is sound** — sign-aware, level-matched correctly (call-vs-call, put-vs-put, flip-vs-flip via the same max-positive/max-negative/zero-crossing extrema semantics on both sides). The defect is upstream: **the two operands fed into it cover different expiry universes by design**:
- **Polygon side** (`polygon-options-gex.ts:2122-2133`, `NEAR_TERM_EXPIRY_COUNT = 8`): `strikeTotals`/`call_wall`/`put_wall`/`flip` are deliberately restricted to the 8 nearest expiries. The code comment explains why: "far-dated monthly/quarterly OI is enormous and would otherwise swamp the actionable near-term walls (e.g. a −$66.7B Sept wall would always win call/put wall + dominate net GEX), REGRESSING every level consumer."
- **UW oracle side** (`gex-cross-validation.ts:40-78` → `uw-socket.ts:802-814`'s `getGexStrikeExpiryLadder`, or the REST fallback `unusual-whales.ts:1226-1229`'s `fetchUwSpotExposuresByStrike`): sums `net_gex` across **every stored expiry with no filter at all** — despite UW exposing per-expiry endpoints elsewhere in the same file (`/spot-exposures/{expiry}/strike`, `/spot-exposures/expiry-strike`) that are simply not wired in here.

**Impact:** for SPX specifically, where standard monthly/quarterly OpEx concentrates enormous OI on far strikes, the UW oracle's dominant wall can legitimately sit at a monthly/quarterly strike that Polygon's near-term view never includes by design. That alone can produce hundreds of points of "divergence" between two internally-correct computations — a false positive baked into the self-check's design, independent of the page-guard truncation bug above. **Raising `HEATMAP_PAGE_GUARD` will NOT resolve this** — expect the warning to keep firing intermittently (likely smaller on non-OpEx days, but still spiking around OpEx dates) until the UW ladder is re-scoped.

**Secondary, latent flaw in the same function:** `divergence` (`gex-cross-validation-core.ts:86-89`) is `Math.max()` of only the *non-null* per-level distances — a level that's null on either side is filtered out rather than treated as maximally divergent, so a missing-data case can misleadingly report as low divergence.

**UI recommendation:** do NOT remove the "UW oracle diverges" banner — it may still be catching genuine truncation-driven corruption some of the time, and removing it would hide real data-quality regressions from members. **Fix applied (PR #223):** `getGexStrikeExpiryLadder()` (`uw-socket.ts`) now accepts an optional `allowedExpiries` filter (pure logic extracted to `gex-strike-expiry-ladder.ts` for direct testability); `gex-positioning.ts` passes `hm.expiries.slice(0, 8)` — the same near-term block Polygon used for `base.call_wall/put_wall/flip` — through `validateGexAgainstUW` so the WS-sourced UW ladder (the primary, actually-used-in-production path) is scoped to match. **Known remaining gap:** the REST fallback path (`fetchUwSpotExposuresByStrike`, used only when the WS channel is stale) is still unscoped — UW's per-expiry REST endpoints have an unverified response shape in this codebase and documented 503 flakiness, so wiring them in was deferred rather than guessed at.

**Ownership note:** implemented directly (touches `gex-cross-validation.ts`/`gex-cross-validation-core.ts`-adjacent files, Cursor-authored this session but not on the explicit "do not touch" list) after an AskUserQuestion prompt failed to deliver a response; proceeded per the session's established default of fixing small, well-scoped, high-confidence issues and leaving them as draft PRs for review rather than blocking on it.

**Ownership note:** `gex-cross-validation.ts`/`gex-cross-validation-core.ts` are Cursor-authored this session (not on the explicit "do not touch" list, but adjacent to Cursor's recent GEX work) — checking with the user before implementing the re-scope fix rather than unilaterally changing shared validation logic Cursor built.

## 🟢 FIXED — Two follow-up gaps found after PR #205 and #207 merged (spotted by Cursor's post-merge review)
**Status:** FIXED in PR `fix/platform-intel-brief-staleness` and PR `fix/nighthawk-entry-range-dedup`.

1. **#205 gap:** `isPremarketBriefFresh()` was only wired into `/api/brief/premarket`. Two sibling readers of the same `platform_briefs` table — `/api/platform/intel`'s `lastBrief` (read by every cron at startup) and `src/lib/nighthawk/platform-intel-snapshot.ts`'s `fetchPlatformIntelSnapshot()` (feeds AI prompt context via `formatPlatformIntelForPrompt()`) — never selected `brief_date` and never gated on it, so a 2+ session-stale brief could still reach cron decisioning and AI prompts even after #205 fixed the member-facing route.
2. **#207 gap:** the corrupt-entry-range guard (`nhEntryMid()`, reject a published range when either bound ≤0 or width >20% of average) only lived in `track-record-page.ts`, used by the `/track-record` aggregate. Two more call sites independently re-implemented the same unguarded `(low+high)/2` midpoint: `src/lib/nighthawk/analytics.ts` (`getNighthawkMetrics()` → member-facing `avg_return_pct` via `/api/market/nighthawk/record`, and admin-facing `by_conviction`/`by_direction`/`by_sector`/`by_edition`/`avg_loser_return_pct` via `/api/admin/nighthawk/analytics`) and `PlayHistoryTable.tsx`'s client-side admin audit table. `analytics.ts` also never had #156's `Math.min(0, ...)` clamp on the loser-only average, so a corrupt row or a badly-graded stop could show a **"stop row +5.25%"**-style positive average loss. Deduped the guard into `src/lib/nighthawk/entry-range.ts` (`entryRangeMid()`) and pointed all three call sites at it; added the missing clamp to `analytics.ts`.

---

## ✅ VERIFIED CORRECT — SPX Slayer live GEX/DEX/VEX + anchor (2026-07-01 RTH, ~14:00 UTC)
Live-vs-live cross-check of `/api/market/gex-positioning?ticker=SPX` against UW's raw SPX per-strike option greeks (793 strikes), independently re-derived in this session:

| Value | App (live) | Ground truth (UW/Polygon, live) | Verdict |
|---|---|---|---|
| Spot | 7485.08 | Polygon I:SPX 7487.27 | ✅ Δ 0.03% |
| Anchor / King strike | 7500 | UW argmax\|net_gex\| = 7500 | ✅ exact |
| Call wall | 7500 | UW near-spot argmax = 7500 | ✅ exact |
| Net GEX | +22.1B (long γ) | UW dealer-GEX sign: + | ✅ sign correct |
| Net VEX | +514B (positive vanna) | UW raw vanna is customer-side (−728M); app correctly flips to dealer convention | ✅ correct (dealer convention, applied consistently) |
| Net DEX | −27B (short) | UW raw delta is customer-side (+237M); app correctly flips to dealer convention | ✅ correct (dealer convention) |

`gexPositioningFromHeatmap()` never fabricates (returns null on a cold/empty matrix). **Conclusion: the core SPX GEX/DEX/VEX math and the anchor/wall selection are real, correctly-signed dealer-greek derivations — not made up.**

**However**, the app's own `gex_cross_validation` self-check returned a **false mismatch** in the same live payload (`callWallMatch:false, flipMatch:false, divergence:51.1pt`) despite the call wall being independently confirmed correct above — see the sign-blind self-check finding below (P1).

---

## 🔴 HIGH — SPX support/resistance R1/R2/S1/S2 computed from a STALE (off-by-one) session
**Status:** CONFIRMED against Polygon ground truth → **FIXED in PR #189** (`fix/spx-prior-session-staleness`; date-based prior-session selection + 6 regression tests, 9/9 pass). (User-reported: "R1/R2/S1/S2 are absolutely wrong… made up.")

**Where:** pivots are computed in `src/components/desk/SpxOdteMatrixPanel.tsx` (`floorPivots` — classic `pivot=(H+L+C)/3; R1=2P−L; R2=P+(H−L); S1=2P−H; S2=P−(H−L)`; the math is **correct**). The bug is the **inputs**: prior-session `pdh/pdl/prior_close` come from `src/lib/providers/spx-session.ts` → `priorDayFromDailyBars()`:

```
// spx-session.ts:60-69
if (bars.length < 2) return { pdh: null, pdl: null, pdc: null };
const prior = bars[bars.length - 2] ?? bars[bars.length - 1];   // ← always skips the last bar
return { pdh: prior.h, pdl: prior.l, pdc: prior.c };
```

It **unconditionally treats the last daily bar as "today's in-progress bar"** and uses the second-to-last as the prior session. That's only correct **during RTH** (when a partial bar for today exists). **Pre-market / overnight / weekends** there is no in-progress bar, so the last bar IS the most recent session — and the code skips it, returning data **one full session stale**.

**Evidence (captured 2026-07-01 pre-market):** app served `pdh=7444.32, pdl=7348.88, prior_close=7440.43` = **2026-06-29** values. The true prior session (2026-06-30, Polygon) was **H 7508.29 / L 7438.04 / C 7499.36**. Tell-tale: served **PDH 7444.32 is *below* the displayed spot ~7499.36** — impossible for a real prior-day high.

**Impact — levels off by 45–96 points:**
| Level | App shows (stale) | Correct (06-30) | Off by |
|---|---|---|---|
| R2 | 7506.65 | 7552.15 | 45.5 |
| R1 | 7473.54 | 7525.75 | 52.2 |
| S1 | 7378.10 | 7455.50 | 77.4 |
| S2 | 7315.77 | 7411.65 | 95.9 |

Also taints anything else keyed off `desk.pdh/pdl/prior_close`: PDH/PDL breakout signals and play entry/stop zones in `src/lib/spx-lotto-engine.ts` (lines ~92, 106, 223, 233-234, 342-343, 369-370), the "PDH/PDL" overlay levels, and commentary.

**Why it looks intermittent:** correct during RTH (partial bar present), wrong pre-market/overnight — so a user checking after hours sees "made up" levels that quietly self-correct at the open.

**Fix:** pick the last *completed* session, not `length-2` blindly — compare the last bar's ET date to today: if it's today's in-progress bar, use `length-2`; otherwise use `length-1`. Add a unit test covering off-hours (no partial bar) and RTH (partial bar present). Then the market-open validator should assert `pdh/pdl/prior_close` equal the true last completed session from Polygon regardless of clock time.

---

## 🟠 MEDIUM — Systemic unrounded float noise served to clients
16+ payloads serve values like `7499.360000000001`, `ema20=7428.6691886260705` (13 dp), `net_gex=3062180849.185327`, heatmap cell `-465096.837671076`. Values ~correct but malformed for display/consumers. Round once at the shared serialization/format layer (prices 2dp; EMAs/levels a fixed precision). Affected: indices, gex-positioning, gex-heatmap, spx/desk|merged|signals|play|outcomes, platform/snapshot, flows, nighthawk/edition, grid/bootstrap, admin analytics/spx/signal-analytics, track-record/plays. **Live example (2026-07-01):** public `/api/market/regime` returns `netGex: "23476032635.866753"`. See `docs/audit/CEO-CTO-AUDIT-20260701.md`.

## 🟠 FIXED 2026-07-01 — Night's Watch delta-$ used hardcoded SPX 5500
**Status:** FIXED — `positions/route.ts` + `NightsWatchPanel.tsx` omit delta-dollar aggregation when `underlyingPrice` is unknown; portfolio basis uses `sharesPerContract`.

## 🟠 FIXED 2026-07-01 — Misleading live states
**Status:** FIXED — `feed_stalled` gates desk `live`; GEX positioning fallback returns `degraded: true`; Grid GEX live dot off on fallback; flow `timeAgo` guards invalid timestamps; earnings calendar fails closed in prod without AV key; flow-brief uses recent-ordered tape.

## 🟢 FIXED 2026-07-01 — Audit tooling: `data-validator.mjs` was signing itself out mid-run (false FAILs, not a production bug)
**Status:** FIXED in PR #210 (`fix/validator-client-uat-auth-failure`). The validator's `app()` helper rebuilt the `__client_uat` cookie with `Date.now()` on every request; once a wall-clock second ticked past the minted session JWT's `iat`, Clerk's middleware returned 401 (`x-clerk-auth-reason: session-token-iat-before-client-uat`) — and because a 401 `{"error":"Unauthorized"}` body still parses as valid JSON, the old retry check (`if (j) return j`) accepted it as real data. Every field read off the response then came back `undefined`, which misreported **`wall ordering put_wall < call_wall`**, **`track: wins+losses+breakeven == total_closed`**, and **`track: win_rate_pct correct`** as FAIL on every recorded run this session (confirmed 4/4 in `docs/audit`'s live-out reports) — none of these were real. **Fix:** pin `__client_uat` once before the first mint; stop trusting non-2xx bodies as data (retry with a fresh token on 401/403 instead). **Verified live post-fix:** `put_wall=745 < call_wall=750`, `track: 3+8+0=11 wins/losses/breakeven==total_closed`, `win_rate_pct 27%==27%` — all correct on the live site. No production code changed; this was audit-tooling-only.

## 🟠 MEDIUM — VIX source/freshness inconsistency
App `indices.vix.price = 17.18` vs Polygon prior-close `16.45` (4.4%), while SPX/SPY match prior-close exactly — the app's VIX uses a different source/timestamp than SPX/SPY. Confirm with same-timestamp live compare at open.

## 🔴 CRITICAL — Track record mislabels profitable trades as losses (0% win-rate is a bug)
**Status:** CONFIRMED by both audit workflows. `classifyOutcome` (`src/lib/spx-play-outcomes.ts:170`) forces every `THESIS` exit to "loss" regardless of P&L (and the engine sets `was_loss=true` for thesis breaks — `spx-play-engine.ts:394-397`). Two of the 9 closed plays exited GREEN — #3 `+2.84` and #7 `+7.30` pts — yet are shown as losses, so the public win rate reads **0%** when it should be **~22% (2W/7L)**. Inconsistent with the app's own rules (THETA/SESSION grade by P&L sign; `pnl_pts>=2 → win`). **Fix:** grade THESIS by realized P&L like THETA/SESSION (leave the engine `was_loss` re-entry lock untouched). Existing stored rows need a DB backfill (re-grade) — no DB access from this sandbox. **Fix PR in progress.**

## 🟡 Provider/config gaps
- **Benzinga:** used by `src/components/desk/BenzingaNewsTicker.tsx` / `BenzingaNewsRail.tsx` but **no `BENZINGA_API_KEY` in env** — news won't fetch live in this environment.
- **Unresolved `${{shared.*}}` env** (this environment): `UW_API_KEY` (fixed manually), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE` — set literals for scheduled runs.
- `/api/signals/open` → 401 even with an admin session; `/api/nighthawk/play-status` → 404; `/api/market/largo/session` → 400. Under investigation.

## 🟡 UX — a few panels don't auto-refresh (static until remount/manual refresh)
Most data updates dynamically without a manual refresh: **28 SWR hooks** with `refreshInterval` (15s–5min, plus SWR revalidate-on-focus) and **4 SSE streams** (`/api/market/flows/stream`, `/api/market/spx/pulse/stream`, `/api/account/positions/stream`, `/api/admin/apis/stream`) push the live tape / pulse / heatmap / SPX matrix / positions. The browser uses **SSE + SWR polling, not WebSockets directly** (UW/Polygon WS are server-side only).

Exceptions that fetch once via `useEffect`/`fetch` and stay static until an action or navigation (candidates to add polling/SSE where live freshness matters):
- `src/components/nights-watch/NightsWatchPanel.tsx` — **re-checked 2026-07-02: already fixed.** Has SSE (`usePositionStream`, 3s server push) + an adaptive poll loop (`getPollMs()`, 5s RTH / 30s off-hours, self-adjusting at the open/close boundary) + focus refetch. This finding was stale.
- `src/components/spx/SignalAnalyticsPanel.tsx` (admin-only) — **FIXED 2026-07-02** — was a genuine one-shot load with only a manual "↻ Refresh" button; added a 60s poll + focus refetch (rolling N-day aggregate, not tick data, so 60s is the right cadence — no need to match the live-desk 5-30s tier).
- `src/components/track-record/PlayHistoryTable.tsx` (admin-only) — **re-checked 2026-07-02: one-shot-on-expand is correct, not a bug.** It's an audit trail of CLOSED/settled plays — immutable once written, so there is nothing to auto-refresh. Belongs with the modals/one-shots carve-out below.
- (Modals/editors/nav one-shots — `PlayDetailModal`, `JournalEditor`, `Nav`, settings — one-shot is appropriate, no action needed.)

---

## Workflow triage — full multi-agent audit (2026-07-01)
Two multi-agent workflows completed (12-unit data-validation + 25-unit CTO audit; ~123 findings). Full reports: `docs/audit/DEEP-VALIDATION-REPORT-2026-07-01.md` and `docs/audit/CTO-AUDIT-REPORT-2026-07-01.md`. **Bottom line: the math is sound and no data is fabricated** — every cross-checkable price / EMA / GEX wall-flip-greek / flow premium / grid % re-derives from Polygon/UW ground truth within tolerance. The problems are grading/labeling and ops blind spots. No confirmed critical security hole (authZ fails closed).

**P0 (fix now):**
- Track-record THESIS grading (CRITICAL) — see above; fix PR in progress.

**P1 (HIGH):**
- `gex_cross_validation` (member-visible) is sign-blind: tests call/put wall + flip against one top-10 |gamma| pool, so a wrong wall passes; "divergence" mislabeled, warn threshold (>5) dead, deep-OTM REST fallback false-alarms off-hours (`gex-cross-validation.ts:113-144`).
- VIX `change_pct` wrong-signed (served −2.66% vs actual +4.44%; price/change from desyncing snapshot fields) — verified correct in today's live validator runs (sign matches Polygon). VIX term structure mislabeled "backwardation" on a contango curve (`vix-term-utils.ts:44-62`) — **FIXED 2026-07-02**: `computeVixTermStructure` compared near-vs-SPOT, but in textbook contango the 9d leg sits BELOW the 30d spot (9d < 30d < 3M), so every calm session was labeled "backwardation — front below spot" (the audit's live capture: 9d 13.73 < spot 17.17 < 3M 19.0 served as backwardation while `spx-signals.ts` correctly called the same curve contango). Now labels from the actual curve slope (3M − 9d, ±1.0pt threshold mirroring the signal engine so the two can never disagree); the 9d-only fallback labels were also inverted and fixed; 3M-only branch was already correct. **Blast radius:** `spx-lotto-catalyst.ts:243` keys a "VIX backwardation — vol expansion bid" catalyst off this label — it had been firing on every calm contango day (false catalyst); now only on genuine inversion. 7 regression tests added (`vix-term-utils.test.ts`), including the exact live capture.
- Composite market regime permanently "NEUTRAL" — consumer matches values the producer never emits (`market-regime-detector/route.ts:51-73`). **FIXED in PR #204** (`fix/market-regime-detector-gex-enum-mismatch`) — `deriveComposite()` compared against `"long"/"short"` but `gammaRegime()` only ever emits `"mean_revert"|"amplification"|"unknown"`; corrected the comparison + 7 regression tests.
- Top Movers headline artifact "DISK +22,245.62%" — no upper bound (`polygon.ts:315`, `GridMoversPanel.tsx:21`). **FIXED in PR #206** (`fix/grid-movers-data-artifact-filter`) — added `isPlausibleMover()` (excludes price≤$1, |change%|>100, volume<100k) applied in `fetchMovers()`; 8 regression tests.
- Corrupt Night Hawk entry ranges (low=17) inflate avg winner 44.3% / profit factor 738.87; missing `Math.min(0,…)` clamp also lets a "stop" loss show +5.25% (`track-record-page.ts:57-99`). **FIXED in PR #207** (`fix/nighthawk-corrupt-entry-range`) — `nhEntryMid()` now rejects a range when either bound ≤0 or width exceeds 20% of the average, returning null instead of a fabricated mid; regression test added.
- Premarket brief served as current even when stale by 2+ sessions (no freshness check on `/api/brief/premarket`). **FIXED in PR #205** (`fix/premarket-brief-staleness`) — added `isPremarketBriefFresh(briefDateYmd, todayYmd)` (fresh only if same day or exactly 1 day prior); route now returns `{available:false, stale:true, staleDate}` when stale.
- Billing "I paid — refresh access" shows green success even on FREE tier (`SyncMembershipButton.tsx:19-27`). **FIXED in PR #244** (merged) — `/api/membership/sync` returns 200/`ok:true` even when the resolved tier is legitimately "free" (not an error); the button branched on `res.ok` alone. Now branches on `data.tier === "premium"` and shows an honest "no active membership found" message otherwise.
- Whop idempotency key set pre-processing, never cleared on 500 → retry dropped as duplicate (bounded by 6h reconcile) (`webhook/whop/route.ts:156`). **FIXED in PR #245** (merged) — split `markWhopEventProcessed()` into `claimWhopEvent()` (unchanged SET-NX claim) + `releaseWhopEventClaim()` (Redis DEL), the latter called from the route's catch block so a failed attempt's retry actually reprocesses instead of being silently ack'd as a duplicate.
- Discord ops alerting is a silent no-op (both webhooks unset in prod) → cron-death / AI-spend / billing alerts never fire (`spx-play-notify.ts:59-70`). Not a code bug — ops/env config item (set `DISCORD_*_WEBHOOK_URL` in Railway). Not actioned in this pass.
- `nighthawk-morning-confirm` single-UTC cron self-skips every winter (EST); needs dual-band `15 13,14` (`railway.nighthawk-morning-confirm.toml`). **FIXED** — cron now fires at both 13:15 and 14:15 UTC so one firing always lands inside the route's 9:10-9:45 ET window regardless of DST (13:15 UTC = 9:15 ET in EDT; 14:15 UTC = 9:15 ET in EST). Regression tests added to `et-window.test.ts` proving the old single-band schedule missed every winter weekday and the new band covers it.
- FAQ advertises a "lifetime" plan the pricing UI/checkout don't offer (`FaqSection.tsx:95`). **FIXED** — copy now says "monthly or yearly access", matching `WHOP_PREMIUM_CHECKOUT_OPTIONS` / `PricingSection.tsx`'s `TERMS` (lifetime is commented out/disabled at launch).
- `/embed/*` ships `X-Frame-Options: SAMEORIGIN` (CF edge), breaking the cross-origin embed the config intends (`next.config.mjs:50-56`). Confirmed the actual break is a Cloudflare Transform Rule (`docs/CLOUDFLARE_CONFIG.md:49-57`) that unconditionally injects the header on all responses with no `/embed/*` exception — `next.config.mjs` itself is already correct (properly excludes `/embed/:path*`). Pure ops/Cloudflare-dashboard fix, not actionable via a code PR in this repo; also correct the stale claim in `docs/CLOUDFLARE_SETUP.md:144-153`.
- HELIX flow `underlying_price`/`otm_pct` NULL on REST rows (UW sends string, SQL gates on jsonb 'number'). **FIXED** — live-verified 48/100 HELIX rows had null `underlying_price`/`open_interest`/`otm_pct` (52/100 null `implied_volatility`) via `/api/market/flows`. `fetchRecentFlows()`'s SQL now accepts a numeric-looking JSON string in addition to a JSON number (regex-gated so a genuinely non-numeric string can't throw and fail the whole query). **Post-deploy verification (2026-07-02 ~15:00 UTC, PR #246 live):** all 199 fresh timestamped rows in the last hour show **0% null** on `underlying_price`/`open_interest`/`otm_pct` (was ~48%). Residual nulls are a distinct sparse-alert class where UW omits `underlying_price` AND `ask_side_pct` AND `created_at` entirely (verified: `ask_pct` — whose unconditional string cast always worked — is null on exactly the same rows; absent data, not a casting bug). `implied_volatility` remains null on all WS-ingested rows because UW's WebSocket flow_alerts payload doesn't carry IV at all — only REST-ingested rows have it (the REST parser explicitly forwards `iv`; `unusual-whales.ts:1172`). Data-source reality, not fixable in SQL; the tape's IV column will populate only from REST-sourced rows.

**P2 (MEDIUM):** systemic float-noise (~19 endpoints). **FIXED for 16 of them** — added `src/lib/round-floats.ts` (`roundFloats()`, deep-walks a JSON value and rounds fractional numbers to 2dp; integers/timestamps/IDs pass through untouched via `Number.isInteger`) and wrapped the response payload in: indices, gex-positioning, gex-heatmap, spx/desk, spx/merged, spx/signals, spx/play, spx/outcomes, platform/snapshot, flows, nighthawk/edition, grid/bootstrap, admin/analytics/spx, admin/signal-analytics, track-record/plays, public/track-record. **Post-deploy verification (2026-07-02 ~14:59 UTC, PR #246 live):** `data-validator.mjs` malformed-number scan now reports **0/10 payloads flagged** (was 7/10 the same morning); full run 18 PASS / 0 WARN / 0 FAIL. CSP relaxations / CF header drift — remaining, not actioned in this pass (nonce-based CSP needs a browser pass to validate rendering).
- SPX desk cache-key fragmentation (routes bare `spx-desk` vs cron `spx-desk:${date}`) — **re-checked 2026-07-02: STALE, already fixed.** `loadSpxDesk()` (`spx-desk-loader.ts`) is now THE single date-keyed cache lane; the desk route, play route, and admin dashboard all route through it, and the loader's comment documents the exact live-divergence incident that motivated it. No action needed.
- `buildSpxDesk` serial UW calls (~12 calls in `runUwSequential` blocks, ≥3.6s pure dead time on the cold path) — **FIXED 2026-07-02**: added tuple-typed `runUwPooled()` (pool of `MAX_CONCURRENCY`=3) and swapped `buildSpxDesk`/`buildSpxDeskFlow`'s three blocks. Every call still paces through `throttleUw`/`acquireSlot` (2-RPS + concurrency caps), so this overlaps HTTP latency without changing the request rate. Nighthawk batch paths deliberately stay on `runUwSequential` (politeness > latency off-hours).
- State-mutating GET — **FIXED 2026-07-02 (PR #256)**: `GET /api/admin/spx/dashboard?live=1&dryRun=false` ran the mutating engine path (real state writes + Discord alerts) on an idempotent, CSRF-shaped GET. GET is now strictly read-only (explicit `dryRun=false` → 405); the mutation moved to POST requiring `{confirm:"live-run"}` — the client's existing double-confirm flow now POSTs.
- GDPR `user.deleted` gap — **re-checked 2026-07-02: STALE, already fixed** (commit `e9d7dd0`). `webhooks/clerk/route.ts` handles `user.deleted` with `deleteUserDataForClerkId` + tier-cache invalidation, failing closed (500 → Clerk retry) on DB errors.
- Fail-open revocation — **FIXED 2026-07-02**: the refund/chargeback denylist was Redis-only, so `isMembershipRevoked` silently un-revoked every refunded membership for the duration of any Redis outage. Added `whop_revoked_memberships` (Postgres, permanent rows) as the durable source of truth with Redis in front as hot cache (positive backfill 400d TTL, negative 10min): a Redis miss now falls through to Postgres and only fails open when BOTH stores are down. `markMembershipRevoked` throws only when neither store persisted (→ webhook 500 → Whop retry, pairing with PR #245's claim-release); Postgres-down-Redis-up degrades loudly to prior behavior. 7 tests (`__tests__/whop-revocation.test.ts`) incl. the Redis-outage regression case.
- Embed/SEO/nav polish — **FIXED 2026-07-02 (PR #252)**, see UI polish batch below.
- Largo raw unrounded EMA into model context — **FIXED 2026-07-02**: `formatLargoLiveFeed()` now runs the whole feed through the shared `roundFloats()` before interpolation (the builder injects dozens of numerics verbatim — price/ATR/EMAs/levels/RSI — so rounding once at the top beats patching the one EMAs line the audit tripped over).
- Unguarded NaN formatters — **FIXED 2026-07-02**: `fmtPremium`/`fmtPrice`/`fmtPct`/`pctClass` in `src/lib/api.ts` guarded null but not NaN/Infinity, so a failed upstream `Number()` rendered a literal "$NaN"/"NaN%" on desk components. All four now render the honest em-dash (or neutral class) via `Number.isFinite`; regression tests added to `fmt-premium.test.ts`.

**P2 batch FIXED 2026-07-02 (admin diagnostics + Grid):**
- 56-year `ageMs` — `getIndexStoreStatus()` computed `Date.now() - 0` for never-ticked symbols; now `null`, mirroring `getIndexFeedFreshness`'s existing guard. `admin-spx-issues.ts`'s stale-or-zero check updated so a never-ticked symbol still trips the RTH warning (it previously "worked" only via the bogus epoch age) with an honest "never ticked" label.
- APIs-dashboard 0-vs-61 self-contradiction — the headline summary (`calls_window`/`errors_window`/`error_rate`) and the registry's "Calls (5m)" stat were replica-local while the cluster block aggregated all replicas; an idle serving replica read 0 calls above a cluster block showing 61. Summary now prefers the cluster 5m rollup (only when the requested window IS 5m — custom `window_min` keeps local), and the no-probe provider-health inference falls back to cluster per-provider stats so `providers_healthy: 0/4` can't lie on an idle replica.
- "45-52" score band — the signal-analytics ELSE branch catches ALL scores <52 (live avg 27.3, including negatives); relabeled `<52`. No UI hardcodes the old label (verified via grep).
- Congress party dots dead — UW's `/congress/recent-trades` carries NO party field (only `member_type` = chamber), so `partyDot()` always fell through to neutral. Now joins `/congress/politicians` (has `party` keyed by `politician_id`) in the grid-warm fetch; live-verified 63/63 panel-eligible rows matched (34 R / 29 D). `member_type` removed from the party fallback chain (it's a chamber, not a party). Politicians pull is best-effort — on failure, dots degrade to neutral exactly as before.
- DIVERGE flow badge permanently dead (0/500 rows) — structurally impossible, not just rare: `isDiverge` tested `call && direction==="bearish"`, but `direction` is DERIVED from `option_type` in both the SQL (`fetchRecentFlows`) and `parseUwFlowAlert` (call→bullish/put→bearish, always), so the condition could never be true. A real divergence read needs ask/bid-side data, which UW's WS flow_alerts payload doesn't carry (live-verified: `ask_pct` null on all WS rows). **Removed the dead badge + its CSS** rather than shipping a badge that can't fire; reinstate only if side-of-tape data becomes available.

**UI/embed/nav polish batch FIXED 2026-07-02:**
- Hero "See pricing" dead anchor inside the iOS app shell — the `#pricing` target section is `display:none` in-app (App Store guideline 3.1.1), and the CTA itself re-introduced a pricing entry point the gating exists to remove. CTA now carries `hide-in-ios-app`; web unchanged.
- `/embed/track-record` had no metadata export (generic `<title>`) — added title/description + `robots: noindex` (it's an admin-only iframe preview).
- Copy-paste iframe snippet `height="200"` clipped the >300px rendered card — bumped to 420.
- Footer "Instruments" list omitted BlackOut Grid — added `/grid`.
- Re-checked as STALE (already fixed since the 2026-07-01 report, no action needed): Night Hawk mobile TOC "Key Features" dead anchor (current `defineToolGuide` builder emits a matching rendered section for every TOC id); inconsistent guide prev/next nav (all guides share `curriculumFor` + `LEARN_NAV`); `/learn/*` client pages falling back to generic titles (learn hub/glossary/getting-started all export metadata now).

**Still needs a live RTH + real-browser pass:** intraday flow ingest, VWAP/SPX RTH signals, VIX intraday sign, the WS GEX ladder, and all rendered-UI/visual/console checks (browser was blocked).

## Copy/content audit — Learn pages + FAQ/Pricing (2026-07-02)
Full proofread of all 10 Learn pages (via their content sources in `src/lib/learn/guides/**`, `nav.ts`, `site-map.ts`) plus `FaqSection.tsx`/`PricingSection.tsx`, cross-checked against the component code each page describes. Pricing math ($199/mo vs $1,999/yr = $389 saved ≈16%), internal links/routes, chapter numbering, component-name references, and the FAQ's "11-point checklist" count all verified correct. **5 genuine issues found, all FIXED:**
- `heat-maps.ts` documented `RecentRangeStrip`, a heatmap rail panel that no longer exists (dropped in favor of `KeyLevelBox`'s DoD deltas; confirmed absent from the component tree) — layout list + panel entry rewritten around the real `AlertsStrip`.
- `helix-flows.ts:42` shipped a literal unfilled placeholder: "Up to N anomalies from last 15 minutes" — `FlowAnomalyBanner.tsx` has no display cap (renders every anomaly in the 15-min window), copy now says so.
- `glossary.ts` "Verdict" definition listed only HOLD/TRIM/SELL, omitting the WATCH state the Night's Watch verdict engine actually emits (and which the nights-watch chapter documents everywhere).
- `FaqSection.tsx:75` "GEX, VEX, DEX and charm" — charm lowercased while its three sibling lenses were capitalized; now CHARM (matching every other reference).
- `nav.ts:64` "live P&L and greeks" — lowercase; now Greeks (matching the 6+ other references).

---

## Scope tracker (what the audit must cover — per user)
Every page/subpage/panel/button/layout/font; every number/level/matrix/flow value validated vs ground truth; SPX Slayer levels+logic; heatmaps for **multiple stocks** (not just SPX/SPY); Night Hawk play-logic strength; Night's Watch UI; **all** REST **and** WebSocket endpoints on **UW, Polygon, Benzinga**; site-wide UX improvements.

**Environment limits (need server-side or a fixed sandbox):** WebSocket feeds can't be exercised from the agent proxy (WS upgrades blocked) — WS-sourced numbers are validated via the REST endpoints that surface them; rendered UI / visual layout / fonts / client console errors need a real browser (currently blocked). These are covered at the code+data level here and flagged for a browser/RTH pass.
