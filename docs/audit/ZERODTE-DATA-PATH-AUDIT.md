# 0DTE open-trade data path — full trace + defect audit (B-9, P0)

**Date:** 2026-07-14 · **Branch:** `fix/zerodte-live-marks` · **Spec:** B-9 in
`docs/audit/0DTE-BREAKTHROUGH-LEDGER.md` (branch `docs/0dte-breakthroughs-w3`).

**User report (verbatim intent):** 0DTE plays open and then "the entire data is wrong — pnl, %,
premium values — like everything"; chain data "always broken or slow"; "very slow to render,
update"; requirement: every number on an open trade updates ~1s.

This document is the Phase-1 diagnosis: the complete path every displayed number takes from
upstream to the member's screen, with file:line evidence, and the defect table (wrong vs stale,
fixed here vs deferred). The Phase-2 build (the live-marks lane) is described at the end.

---

## 1. The full data path, upstream → screen (as found, pre-B-9)

### 1.1 Entry premium (the pinned reference)

- UW flow prints land in `flow_alerts`; `fetchRecentFlows` maps `raw_payload->>'price'` →
  `fill_price` (per-contract premium, db.ts:1918) — what the smart-money tape PAID, possibly
  hours before the scan flags the ticker.
- `deriveZeroDteSetups` (board.ts) computes `top_strike_avg_fill` = premium-weighted average
  fill on the winning strike (board.ts:494).
- `attachContractPlans` (scan.ts:250) fetches ONE batched Polygon unified snapshot for the top
  contracts and `buildContractPlan` (plan.ts:66) sets `entry_max = flowAvgFill ?? mark`
  (plan.ts:81) — flow's fill first, live mark at flag time only as fallback.
- `persistZeroDteScan` (scan.ts:319) writes `entry_premium =
  resolveLedgerEntryPremium(plan.entry_max, top_strike_avg_fill)`; the upsert **pins it forever**
  at first flag (`COALESCE(zerodte_setup_log.entry_premium, EXCLUDED.entry_premium)`,
  db.ts:4350) together with direction/top_strike/expiry/plan_json.

So: **entry premium provenance = UW flow fill (fallback: Polygon snapshot mark at flag), pinned.**

### 1.2 The live mark (pre-B-9)

- `syncLedgerLiveState` (scan.ts:441) collects `plan_json.occ` for non-CLOSED rows and calls
  `fetchOptionsUnifiedSnapshot` (REST `/v3/snapshot`, options-snapshot.ts:251) under a 2.5s
  soft deadline (`within(..., 2_500)`, scan.ts:448-453).
- The snapshot's `mark` ladder is `mid(bid,ask) → last_trade.price → session.close`
  (options-snapshot.ts:153-166). **No provenance and no timestamp survive** — the caller gets a
  bare number.
- Status/peak/trough latch via `derivePlayStatus` (plan.ts:232) and persist through
  `updateZeroDteLiveState` (db.ts:5025, GREATEST/LEAST latch, `last_mark = COALESCE($4, last_mark)`).
- Who runs this sync: (a) the `zerodte-warm` cron every ~1–5 min (scan.ts:424 via
  `warmZeroDteBoard`), (b) every board build (zerodte-service.ts:107), (c) Largo's ambient feed
  (scan.ts:517).

### 1.3 Cache layers between the mark and the member (pre-B-9)

| Layer | Location | Behavior |
|---|---|---|
| Polygon REST snapshot | options-snapshot.ts:251 | real-time at fetch, rate-limited funnel |
| 2.5s soft deadline | scan.ts:448 (`within`) | on timeout → `snaps=null` → **rows returned with the last persisted `last_mark`** (cron write, up to ~2 min old) and the whole status pass skipped |
| `zerodte:board:v1` 5s cache | zerodte-service.ts:60,144 (`withServerCache`) | **SWR default** (server-cache.ts:124,157): an expired entry returns the PREVIOUS build immediately and refreshes in background |
| Redis layer of the same key | server-cache.ts:97 | cross-replica reuse of the same aged payload |
| Client SWR poll | ZeroDteBoard.tsx:613-615 | 10s while session live (60s closed) |

**Net effect with one continuous viewer:** poll at T returns the payload built at T−10s (SWR
handoff), whose marks were fetched then — so the "live" mark on screen is typically **10–25s
old**, and silently **up to ~2 min old** whenever the snapshot fetch trips the 2.5s deadline
(the fallback is invisible: `as_of` is stamped at build time, zerodte-service.ts:125, and the
freshness chip compares only build-age, ZeroDteBoard.tsx:78-87). 0DTE premium moves 10–30%/min
near gamma → the member reads this as "everything is wrong", not merely slow.

### 1.4 Where P&L% was computed (pre-B-9)

- Server, one formula duplicated privately: `livePnlPct` in zerodte-service.ts:62-65, applied in
  `mapLedgerRow` (…:84) and re-applied after `roundFloats` (…:133-139).
- `derivePlayStatus` (plan.ts:240-243) computes its own copy for the status machine (returns
  `live_pnl_pct: -50` for a stopped row — a value the service then **discarded**, see D-1).
- Client renders the payload value; intel.ts composes text from it.

---

## 2. Defect table

| ID | Sev | Class | Root cause (file:line) | Status |
|---|---|---|---|---|
| D-1 | P0 | **WRONG value** | Stopped plays display a frozen, arbitrary P&L. `syncLedgerLiveState` skips CLOSED rows (scan.ts:463), freezing `last_mark` at whatever tick crossed the stop (e.g. −38% or −55%, whichever quote latched the trough); `mapLedgerRow` recomputed `live_pnl_pct` from that frozen mark for CLOSED rows too (zerodte-service.ts:84 pre-fix), discarding `derivePlayStatus`'s correct `-50`. The play then reads "CLOSED −38.1%" all afternoon and becomes "LOSS −50%" the NEXT session (the plan grader only runs on `session_date < today`, db.ts:4939-4946). intel.ts:170's `livePnlPct <= -50` check also misfires on the frozen value → wrong narrative ("closed at the 3:30 hard exit") for a stopped play. | **FIXED here**: `closedStopReason` + pin to `PLAN_RULES.stop_pct` (marks-math.ts, zerodte-service.ts mapLedgerRow + post-round recompute), tested (live-marks.test.ts, zerodte-service-marks.test.ts). |
| D-2 | P0 | **WRONG value presented as live** | Mark provenance/age erased. options-snapshot.ts:153-166's ladder silently serves a last trade (possibly 30+ min old on an illiquid contract) or even the prior `session.close` as "the mark"; `syncLedgerLiveState` stores it as `last_mark` with no asOf/source; the UI renders "Mark $X (+Y%)" under a "live" chip (`as_of` = build time, not quote time). | **FIXED here** (structural): live-marks lane carries `{bid, ask, mid, last, mark, source, asOf}` per contract; mid is the mark, last-trade fallback is FLAGGED, prior-session close is EXCLUDED as a live mark (marks-math.ts `resolveZeroDteMark`); board rows carry `mark_as_of`/`mark_source`; client dims >5s (stale-honesty). Legacy sync lane still lacks per-quote timestamps — surfaced honestly as `mark_as_of: null`. |
| D-3 | P1 | Staleness-as-wrongness | 3-layer poll stack (see §1.3): 10–25s typical mark age; ~2 min worst case via the silent `within` fallback (scan.ts:448, `if (!snaps) return rows` also skips the 15:30 hard-close pass that tick). | **FIXED here** for open-trade numbers: the ~1s live-marks lane (SSE + REST fallback) + the poller's own store-sourced ledger sync (which also applies the 15:30 time stop every second, closing D-3's skipped-hard-close corner). Board/chain snapshot cadence deliberately unchanged per spec. |
| D-4 | P1 | Mixed provenance (by design, must be labeled) | `entry_premium` = flow's avg fill (hours-old smart-money price), mark = live quote; CHASE_PCT=35 (plan.ts:25) admits flags with mark up to +34.9% above the fill → the row can show "+34% P&L" the second it opens, a gain no member could have. Both sides are per-contract premium (units verified: `premium = contracts × fill × 100`, board.ts:385), so the math is consistent — the LABEL is the issue. | **Documented; partially addressed**: P&L stays pinned-entry by product methodology (it is what the grader scores; changing it would rewrite the track record). `plan_json.mark` already pins the mark-at-flag for a future "vs your fill" display. The UI already shows "(flow paid ~$X)" next to entry. Deferred: explicit "entry basis: flow fill" label on the row. |
| D-5 | P2 | Divergent readers | Different components read different caches with different asOf: board payload (5s SWR), Largo ambient feed (`zeroDtePlaysFeed`, scan.ts:514 — syncs its own snapshot fetch), BIE (through the board cache). Each could show a different mark for the same play in the same second. | **Mitigated here**: the store is now the preferred mark source for the board payload (overlay) and the ONLY source for the SSE lane; the poller persists the same store to the DB the other readers consume. Full unification of `zeroDtePlaysFeed` onto the store is deferred (it lives in scan.ts — owned by a sibling branch this cycle; its DB-latch writes are compatible either way). |
| D-6 | P2 | Pre-#309 index-root rows | `plan_json.occ` built via `buildOcc` maps SPX→SPXW (options-socket.ts:308) and UW tape rows already carry real option roots (SPXW/NDXP), so OCCs are correct; the #309 class (spot grading via `I:` namespace) is fixed on trunk. Remaining risk: historical rows pre-backfill show null grades until the P-6 regrade runs. | Verified fixed on trunk (#309/#311); no action here. |
| D-7 | P2 | Unbounded quote spend vs no live lane | The only per-second-capable primitive (options WS engine, options-socket.ts) was wired exclusively to Night's Watch `user_positions` (reconciler, options-socket.ts:892-894) — 0DTE plays never subscribed, so the platform's real-time infra sat unused for exactly the surface that needed it. | **FIXED here**: the lane subscribes the bounded active set into the existing pool (idempotent; the pool's reconciler set-diffs only its own symbols, so no teardown conflict). |

FINDINGS.md carries the D-1/D-2/D-3 entries (severity, root cause, fix, status).

---

## 3. Phase-2 build — the live marks lane (what shipped)

**New files**
- `src/lib/zerodte/marks-math.ts` — pure single-derivation rules: `resolveZeroDteMark` (mid is
  the mark; last-trade fallback FLAGGED; day-close excluded), `pinnedLivePnlPct` (THE P&L
  formula, pinned entry), `isZeroDteMarkStale` (5s honesty bar), `closedStopReason` /
  `ledgerDisplayPnlPct` (D-1), `advancePlayLatch` (the latch + status machine as a pure fn).
- `src/lib/zerodte/live-marks.ts` — the lane: bounded active set (open ledger plays with a plan
  OCC, cap 16, refreshed 10s), in-memory mark store stamped `asOf`+`source`+`lane`, ~1s poller
  (WS-first via the existing options-socket store incl. its Redis cross-replica write-through;
  ONE batched REST `/v3/snapshot` per tick for WS-misses only), store-sourced ledger sync
  (status flips persist immediately, heartbeat 10s), memoized payload builder shared by all
  subscribers.
- `src/app/api/market/zerodte/marks/stream/route.ts` — SSE at 1s (auth = board route's
  premium + nighthawk gate; backpressure + heartbeat + connection cap per vector/stream
  pattern).
- `src/app/api/market/zerodte/marks/route.ts` — REST fallback, same payload, no-store.
- `src/features/nighthawk/hooks/useZeroDteLiveMarks.ts` — EventSource with retry; REST poll
  (2.5s) only while the stream is quiet; 1s clock for staleness.

**Edited**
- `src/lib/platform/zerodte-service.ts` — P&L now imports `pinnedLivePnlPct` (the private copy
  is deleted); D-1 pin via `closedStopReason`; fresh store marks overlay `last_mark` with
  `mark_as_of`/`mark_source` (additive payload fields); board consumers keep the lane's poller
  alive.
- `src/features/nighthawk/components/ZeroDteBoard.tsx` — consumes the hook; `overlayLiveMark`
  (pure, tested) applies pushed marks to OPEN/HOLD/TRIM rows only; mark + P&L cells dim
  (`opacity-40` + title) past the 5s bar; "Live" detail row labels a last-trade-quote mark and
  staleness. P&L is rendered from pushed values — the client computes nothing.

**Deliberately unchanged:** `scan.ts` (sibling branch owns it; its `syncLedgerLiveState` keeps
running on the cron as belt-and-suspenders — both writers persist through the same
GREATEST/LEAST DB latch so they can only widen, never fight), `board.ts` (zero hunks), the
board/chain snapshot cadence, and the ledger's pinned `entry_premium` semantics.

**Mark source shipped:** WS-when-enabled (`OPTIONS_WS_ENABLED` + leader election already in
options-socket.ts) with the 1s bounded REST poller as the always-on guarantee lane. Honest
status: this sandbox blocks WebSocket upgrades (CLAUDE.md), so the WS path could not be
exercised live from here — it reuses the exact `getLiveOptionMark` store the Night's Watch
engine already runs in production. The REST lane was smoke-tested live (see below).

**What "~1s" actually achieves end-to-end:** quote → store ≤1s (REST tick) or ~tick-latency
(WS); store → SSE frame ≤1s (tick) with ~0.9s payload memo; SSE → DOM immediate. Net ~1–2s
typical for the REST lane, sub-second once a WS tick lands mid-window. The REST fallback path
(stream down) is ~2.5–3.5s. The board's other numbers (setups, evidence, chain) intentionally
remain on their existing cadence.
