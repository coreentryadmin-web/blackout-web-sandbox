# Audit — Batch 06: SPX Desk + Admin

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Plan:** `audits/AUDIT-PLAN.md` Batch 06  
> **Audited:** 2026-06-19 · **Step 2 + Step 3 complete**  
> **Scope:** 111 files — SPX play engine, lotto, desk merge/live, signals, hooks/UI, admin dashboards, telemetry, cron ops, `db.ts`  
> **Cross-check:** `complete-repo-bugs/AUDIT-SPX-Admin-Frontend.md`

---

## Coverage stats

| Metric | Value |
|--------|------:|
| Files in batch | 111 |
| Files read in full | **111** |
| Files incomplete / skipped | **0** |
| Lines read (approx.) | ~28,500 |
| Scripts (dev/ops) | 2 |
| Production lib modules | 68 |
| Components + hooks | 40 |
| Admin page | 1 |

---

## Focus verification (requested)

### SPX play engine gates

**Status: Mostly consistent; promote/cooldown races are the main risk**

| Layer | Location | Verdict |
|-------|----------|---------|
| Session cutoffs | `spx-play-session-guards.ts:1-5` | ✅ Flat entry vs open-play force-exit documented and separated |
| Flat entry gates | `spx-play-gates.ts:62-243` | ✅ No-entry cutoff, cash open, opening range, VIX, confirmations, weighted conflicts |
| Open-play path | `spx-play-engine.ts:279-315` | ✅ Uses force-exit cutoff only — no entry gates on manage path |
| Promote path | `spx-play-engine.ts:607-633` | ✅ Strips cooldown/re-entry/score blocks; GEX/stale/VIX/macro/confirmations still apply |
| Adaptive gates | `spx-play-telemetry.ts:22-32` | 🟠 5m in-process cache — can lag after closes (B06-021) |
| THETA exit | `spx-play-engine.ts:307-308` | 🟠 `was_loss: false` on force exit regardless of PnL (B06-008) |
| Promote threshold | `spx-play-engine.ts:524-551` | 🟠 Watch uses `playPromoteMinScore()` (48); adaptive floor higher (58+) (B06-009) |

### Signal routing

**Status: Threshold math sound; dedup partially fixed; DB layer weak**

| Item | Location | Verdict |
|------|----------|---------|
| Action thresholds | `spx-signals.ts:357-372` | ✅ Symmetric — ≥22 CALL, ≤-22 PUT, \|≥10\| HOLD, else WAIT |
| Grade bands | `spx-signals.ts:372` | ✅ 72/58/45/30 with conflict caps |
| Weighted conflicts | `spx-play-conflicts.ts:69-101` | ✅ Gate at `playWeightedConflictBlockMin()`; full entry requires ≤2 |
| Signal log key | `providers/spx-signal-log.ts:29-30` | ✅ **FIXED** since prior audit — stable `session\|action\|direction` (no score/headline jitter) |
| Cursor dedup | `providers/spx-signal-log.ts:59-60` | 🟠 Consecutive-only + check-then-set race (B06-007) |
| DB insert | `db.ts:692-727` | 🟠 Append-only, no `ON CONFLICT` / unique index (B06-006) |

### Admin auth

**Status: Fail-closed at route/page layer; libs assume caller gated**

| Layer | Pattern | Verdict |
|-------|---------|---------|
| Admin page | `admin/page.tsx:9` — `requireAdmin()` | ✅ Server redirect if denied |
| Admin APIs | `admin-access.ts` — `requireAdminApi()` | ✅ 401/403 JSON (Batch 03 verified all routes) |
| Admin libs | `admin-*.ts` builders | 🟠 No auth inside libs — security depends on every caller (B06-030) |
| Admin = | `admin-access.ts:5-14` | Clerk `role=admin` OR `ADMIN_EMAILS` allowlist |
| Telemetry UI | `AdminApiEventDetail.tsx:115-135` | 🟠 Full URLs/bodies rendered — keys in query strings may leak (B06-007) |

### db.ts constraints

**Status: One-open-per-session present; signal/outcome/lotto gaps**

| Constraint | Location | Verdict |
|------------|----------|---------|
| One open play / session | `db.ts:197-198` partial unique | ✅ Present |
| `insertOpenSpxPlay` | `db.ts:848-886` | 🔴 Close+insert not transactional; 23505 still runs side effects (B06-002) |
| `spx_signal_log` | `db.ts:692-727` | 🟠 No unique on `signal_key` (B06-006) |
| `spx_play_outcomes` open rows | `db.ts:966-1017` | 🟠 No one-open-per-`open_play_id` unique (B06-012) |
| `lotto_plays` | `db.ts:252-282` | 🟠 Index not unique on `(session_date, pick_index)` (B06-013) |
| Session meta | `spx-play-store.ts:72-100` | 🔴 Single JSON blob, last-write-wins (B06-005) |
| TLS | `db.ts:35-40` | 🟡 `rejectUnauthorized: false` on remote pool (B06-015) |

### Cron overlap

**Status: Logging only — no lock; multiple mutation sources**

| Source | Location | Verdict |
|--------|----------|---------|
| Cron route | `cron/spx-evaluate/route.ts:42-55` | 🔴 No advisory lock / skip-if-running (B06-003) |
| Cron auth | `spx-evaluate/route.ts:13-18` | 🟠 `?secret=` accepted (B06-014) |
| Registry | `cron-registry.ts:28-36` | ✅ `spx-evaluate` ~5m, stale 20m — informational |
| Heartbeat | `play-engine-heartbeat.ts:1-24` | 🔴 Per-process memory only (B06-004) |
| Admin Live tab | `AdminSpxDashboard.tsx:840-852` | 🔴 Auto `load(true)` + 10s poll — runs evaluator (B06-010) |
| Market API | `market/spx/play/route.ts` | 🔴 Also calls `evaluateSpxPlay` (B06-001) |
| Largo tool | `platform/spx-service.ts:70-79` | 🔴 `getSpxPlayState()` evaluates (B06-001) |

---

## File inventory (all 111 read in full)

| # | File | Area |
|---|------|------|
| 1 | `scripts/analyze-api-usage.mjs` | Ops |
| 2 | `scripts/e2e-spx-probe.mjs` | Ops |
| 3 | `src/app/admin/page.tsx` | Admin page |
| 4 | `src/components/SpxDashboard.tsx` | Desk UI |
| 5–16 | `src/components/admin/Admin*.tsx` (12) | Admin UI |
| 17–35 | `src/components/desk/*.tsx` (19) | Desk UI |
| 36–43 | `src/hooks/use*.ts` (8) | Hooks |
| 44 | `src/lib/admin-access.ts` | Admin auth |
| 45–56 | `src/lib/admin-*.ts` (12) | Admin libs |
| 57–63 | `src/lib/api-telemetry*.ts`, `api-tracked-fetch.ts`, `api.ts` | Telemetry + client API |
| 64–66 | `src/lib/cron-*.ts`, `db.ts` | Cron + DB |
| 67–69 | `src/lib/engine.ts`, `market-api-auth.ts`, `market-health.ts` | Engine + auth |
| 70–73 | `src/lib/platform/*.ts` (4) | Platform services |
| 74–78 | `src/lib/play-engine-*.ts`, `redis-pubsub.ts`, `server-cache.ts`, `shared-cache.ts` | Engine health + cache |
| 79–80 | `src/lib/spx-commentary-*.ts` | Commentary |
| 81–83 | `src/lib/spx-desk-*.ts` | Desk merge/load/live |
| 84–89 | `src/lib/spx-lotto-*.ts` (6) | Lotto |
| 90–111 | `src/lib/spx-play-*.ts` (22) + `spx-signals.ts`, `spx-sniper-backdrops.ts`, `spx-market-session.ts` | Play engine |

---

## Step 2 — Full read audit

### Play engine core

| File | Role | Verdict |
|------|------|---------|
| `spx-play-engine.ts` | Main evaluator — flat/open/promote/close | 🔴 Concurrent mutation + THETA `was_loss` (B06-001, B06-008, B06-011) |
| `spx-play-gates.ts` | Entry gate matrix | 🟠 Macro hard block ignores event time (B06-010) |
| `spx-play-store.ts` | Session meta persistence | 🔴 Last-write-wins race (B06-005) |
| `spx-play-session-guards.ts` | ET window helpers | ✅ |
| `spx-play-confirmations.ts` | Multi-factor confirmation checks | ✅ Fail-closed on missing data |
| `spx-play-conflicts.ts` | Weighted opposition | 🟡 Possible double-count tide/GEX (B06-018) |
| `spx-play-claude.ts` | Claude veto gate | 🟠 Single DB cache slot + budget race (B06-019, B06-020) |
| `spx-play-watch.ts` | Watch → promote pipeline | 🔴 `consumeWatchRecord` ordering (B06-009) |
| `spx-play-options.ts` | Polygon chain ticket | 🟠 Direct fetch, apiKey in URL (B06-016) |
| `spx-play-outcomes.ts` | Outcome analytics rows | 🟠 Per-process memory fallback; no open-row unique (B06-012) |
| `spx-play-telemetry.ts` | Adaptive gate stats | 🟠 Stale 5m cache (B06-021) |
| `spx-play-config.ts` | Env thresholds | 🟡 Claude gate defaults on when key present (B06-033) |
| `spx-play-mtf.ts` | MTF alignment | ✅ Hard vs soft paths documented |
| `spx-play-technicals.ts` | Polygon bars for play | 🟠 Module cache thundering herd (B06-022) |
| `spx-play-chain.ts` | Chain row helpers | ✅ Thin |
| `spx-play-intel.ts` | Lean direction resolver | 🟡 Fallback thresholds differ from gates (B06-034) |
| `spx-play-notify.ts` | Discord webhooks | 🟡 Fire-and-forget (B06-035) |
| `spx-play-lotto.ts` | Deprecated shim | ✅ Re-exports lotto engine |
| Remaining `spx-play-*` | Thesis, idle, memory-id, session-time | ✅ Low risk |

### Lotto engine

| File | Verdict |
|------|---------|
| `spx-lotto-engine.ts` | ✅ Catalyst + scoring pipeline sound |
| `spx-lotto-store.ts` | 🟠 Multi-instance meta races (B06-023) |
| `spx-lotto-options.ts` | 🟠 Same Polygon key-in-URL as play options (B06-016) |
| `spx-lotto-outcomes.ts` | 🟠 Per-process `memoryIds` dedup (B06-024) |
| `spx-lotto-catalyst.ts` | ✅ |
| `spx-lotto-copy.ts` | ✅ |

### Desk pipeline + UI

| File | Verdict |
|------|---------|
| `spx-desk-merge.ts` | 🔴 Module `lastGoodStructure` never resets (B06-002) |
| `spx-desk-loader.ts` | 🟠 `staleWhileRevalidate: false` — empty on slow rebuild (B06-028) |
| `spx-desk-live.ts` | ✅ Server prompt helper only |
| `spx-market-session.ts` | ✅ ET RTH helpers |
| `SpxDashboard.tsx` | 🟡 Ignores `deskLoading` (B06-040) |
| `SpxTradeAlerts.tsx` | 🔴 Stale play hero after session; `desk` prop unused (B06-001, B06-011) |
| `SpxCommentaryRail.tsx` | 🟠 12h cache + swallowed errors (B06-012, B06-041) |
| `useMergedDesk.ts` | 🟠 12h cache; `live` vs `sessionActive` mismatch (B06-013, B06-027) |
| `useSpxPlay.ts` | 🔴 Polls stop but cache persists when session inactive (B06-001) |
| `useLiveSpxTape.ts` | 🟠 Tape not cleared when seed empty (B06-014) |
| Other desk components | 🟡 Cosmetic offline states; no ErrorBoundary anywhere |

### Admin surface

| File | Verdict |
|------|---------|
| `AdminSpxDashboard.tsx` | 🔴 Live tab auto-eval + 10s poll (B06-010) |
| `admin-spx-dashboard.ts` | 🟠 Default snapshot `play: null`; sync incidents on GET (B06-031) |
| `admin-spx-issues.ts` | 🟠 `health_ok` ignores issue counts (B06-026) |
| `admin-health.ts` | 🟠 Always `play: null` in banner snapshot (B06-025) |
| `admin-cron-health.ts` | 🟠 48-run cap, stale display mismatch, heartbeat override (B06-027–029) |
| `admin-api-dashboard.ts` | 🟠 `probe=false` marks providers unhealthy (B06-028) |
| `AdminApiDashboard.tsx` | 🟠 8s telemetry refresh flicker (B06-028) |
| `AdminApiEventDetail.tsx` | 🔴 Raw telemetry URLs/bodies (B06-007) |
| Other admin components | ✅ Auth error handling present; Night Hawk tab read-only |

### Infrastructure

| File | Verdict |
|------|---------|
| `db.ts` | 🔴 Transaction + constraint gaps (B06-002, B06-006, B06-012, B06-013) |
| `cron-run.ts` / `cron-registry.ts` | ✅ Log-only; no lock by design |
| `play-engine-heartbeat.ts` | 🔴 Per-process (B06-004) |
| `server-cache.ts` | 🟠 SWR inflight gap (B06-022) |
| `api-telemetry*.ts` | 🟠 Unsanitized body/snippet persist (B06-032) |
| `market-api-auth.ts` | 🟠 Cron `?secret=` (B06-014) |
| `engine.ts` | 🟡 Secret in URL query (B06-016) |
| `api.ts` | ✅ Client fetches gated routes; play/lotto same-origin |

---

## Findings — Step 2

### 🔴 C1 — Stale BUY/HOLD hero shown after session ends

**Files:** `SpxTradeAlerts.tsx:196-211`, `useSpxPlay.ts:51-70`

**Bug:** When `sessionActive=false`, polling stops but SWR `fallbackData` + `mergePlayWithCache` still returns the last play. Hero renders when `play != null` regardless of `live`.

**Impact:** User may act on a morning BUY signal after RTH — header can show OFFLINE while hero still displays entry/stop/target.

**Fix:** Clear play cache when `!sessionActive`; gate hero on `live && sessionActive`; show explicit “session ended” empty state.

---

### 🔴 C2 — Sticky structure cache never resets across sessions

**File:** `spx-desk-merge.ts:64-116,205-220`

**Bug:** Module-scoped `lastGoodStructure` persists for SPA lifetime. Pulse gaps fall back to prior-session HOD/LOD/VWAP/MAs.

**Impact:** Wrong structural levels in ladder, header, structure blocks — feeds play-engine inputs when merge runs client-side.

**Fix:** Reset on `session_date` change or midnight ET boundary; TTL-bound sticky fallback.

---

### 🔴 H1 — Side-effecting evaluator invoked from four uncoordinated paths

**Files:** `spx-play-engine.ts:851+`, `cron/spx-evaluate/route.ts:52-54`, `admin-spx-dashboard.ts:177`, `market/spx/play/route.ts:27`, `platform/spx-service.ts:70-79`

**Bug:** `evaluateSpxPlay` mutates DB (open/close play, meta, outcomes, Discord, signal log) from cron, admin `?live=1`, premium market GET, and Largo `getSpxPlayState()`. No advisory lock or idempotency.

**Impact:** Parallel ticks race gates; duplicate opens, outcomes, notifications, signal logs.

**Fix:** Single writer (cron worker only); read paths return snapshots; `pg_try_advisory_lock(hashtext('spx-evaluate'))` around mutation.

---

### 🔴 H2 — `insertOpenSpxPlay` non-transactional; duplicate side effects on unique violation

**Files:** `db.ts:848-886`, `spx-play-engine.ts` (post-insert `recordBuy` / `recordPlayEntry`)

**Bug:** UPDATE-close and INSERT are separate queries. On `23505`, returns existing id but engine still runs buy side effects.

**Fix:** Transactional close+insert; return `{ id, created }`; skip telemetry when `created === false`.

---

### 🔴 H3 — No distributed cron lock / overlap guard

**File:** `cron/spx-evaluate/route.ts:42-55`

**Bug:** `logCronRun` only — no skip-if-running. Multi-instance + ~5m schedule allows concurrent evaluation.

**Fix:** Advisory lock at route start; optional min interval since last success.

---

### 🔴 H4 — Play-engine heartbeat is per-process memory

**File:** `play-engine-heartbeat.ts:1-24`

**Bug:** `lastTickAt` / `tickCount` module globals. Admin cron-health can show healthy while no instance ticks, or miss stale replicas.

**Fix:** Persist last tick to `platform_meta` or `cron_job_runs`; treat in-memory as cache.

---

### 🔴 H5 — Session meta last-write-wins breaks cooldown gates

**File:** `spx-play-store.ts:72-100`

**Bug:** Read/modify/write single `platform_meta` JSON without versioning. Concurrent evaluators overwrite `last_sell_at`, `last_stop_at`.

**Fix:** Atomic `jsonb_set`, optimistic CAS, or serialize behind H3 lock.

---

### 🔴 H6 — Admin Live tab auto-runs and polls live engine every 10s

**Files:** `AdminSpxDashboard.tsx:840-852`, `admin-spx-dashboard.ts:180`

**Bug:** Entering Live calls `load(true)` without confirm; interval uses `load(live)` every 10s — each triggers `evaluateSpxPlay` + `recordPlayEngineTick("admin_live")`.

**Impact:** Unintended production mutations; distorts cron-health heartbeat signals.

**Fix:** Require `ConfirmModal` for every live run; never poll with `live=1`; read-only desk refresh on interval.

---

### 🔴 H7 — Telemetry UI may expose API keys in URLs

**Files:** `AdminApiEventDetail.tsx:115-135`, `admin-api-dashboard.ts:129-135`

**Bug:** Renders `request_url` verbatim. Polygon probes embed `apiKey=` in query strings.

**Fix:** Redact `apiKey`/`token` before persist and display (extend `api-tracked-fetch` scrubber).

---

### 🔴 H8 — `consumeWatchRecord` can skip DB persistence / allow double promote

**File:** `spx-play-watch.ts:86-94`

**Bug:** Marks memory consumed before `loadWatchRecord` completes; DB-off path never persists consumed flag; DB-on can reload stale unconsumed row.

**Fix:** Persist consumed flag first; fix load ordering; CAS on watch meta.

---

### 🟠 M1 — `spx_signal_log` append-only; no DB-level dedup

**Files:** `db.ts:692-727`, `providers/spx-signal-log.ts:59-76`

**Bug:** Stable key fixed score jitter (prior S1 **FIXED**), but cursor is consecutive-only and check-then-set without transaction. Concurrent BUY logs duplicate.

**Fix:** `UNIQUE (session_date, action, direction)` or `(signal_key)` + `ON CONFLICT DO NOTHING`; cursor update in same TX as insert.

---

### 🟠 M2 — THETA force-exit sets `was_loss: false` regardless of PnL

**File:** `spx-play-engine.ts:307-308`

**Bug:** Underwater THETA exits skip re-entry lock (`playReentryLockSec`) even when PnL is negative.

**Fix:** Derive `was_loss` from `pnl_pts` / `classifyOutcome` before `savePlaySessionMeta`.

---

### 🟠 M3 — Promote threshold mismatch (watch vs adaptive)

**File:** `spx-play-engine.ts:524-551`

**Bug:** `evaluateWatchPromote` uses `playPromoteMinScore()` (48); adaptive gate uses `effectivePromoteMinScore` (58+). Watch can show eligible then fail at adaptive layer.

**Fix:** Pass effective promote min into watch eval after loading adaptive gates.

---

### 🟠 M4 — Macro hard block ignores scheduled event time

**File:** `spx-play-gates.ts:36-58`

**Bug:** Blocks when CPI/FOMC/NFP strings appear in `desk.macro_events` during fixed ET windows, regardless of whether event is today/now.

**Fix:** Filter events by scheduled datetime ±N minutes.

---

### 🟠 M5 — Fire-and-forget `recordPlayEntry` can lose outcome rows

**File:** `spx-play-engine.ts:758-777`

**Bug:** `recordPlayEntry` inside `firePlayTelemetry` (void catch). Open play persists; analytics row may never write.

**Fix:** Await in critical path or retry with incident on failure.

---

### 🟠 M6 — Missing unique on open `spx_play_outcomes` per `open_play_id`

**File:** `db.ts:966-1017`

**Fix:** `CREATE UNIQUE INDEX … ON spx_play_outcomes(open_play_id) WHERE outcome = 'open'`.

---

### 🟠 M7 — `lotto_plays` lacks unique on `(session_date, pick_index)`

**File:** `db.ts:252-282`

**Fix:** `UNIQUE (session_date, pick_index)` or serialize via meta lock.

---

### 🟠 M8 — CRON_SECRET accepted via query string

**Files:** `market-api-auth.ts:8-10`, `cron/spx-evaluate/route.ts:17-18`

**Fix:** Bearer header only; reject `?secret=`.

---

### 🟠 M9 — Claude DB cache single slot + budget race

**File:** `spx-play-claude.ts:65-72,97-101,278`

**Bug:** One meta key for all cache entries; budget incremented before Anthropic call; multi-replica races.

**Fix:** Multi-key DB cache; atomic budget (`INCR` / row lock); increment after success.

---

### 🟠 M10 — Admin cron health accuracy gaps

**File:** `admin-cron-health.ts:59-218`

**Issues:** Global 48-run cap undercounts `runs_24h`; `stale_after_min` display ≠ effective threshold; heartbeat override masks quiet cron logs; Nighthawk publish can upgrade unknown→healthy.

---

### 🟠 M11 — Admin SPX `health_ok` decoupled from issue severity

**Files:** `admin-spx-issues.ts:317-321`, `admin-health.ts:34-37`

**Bug:** `health_ok` uses market-health aggregate with `play: null` — critical desk issues can show healthy banner.

**Fix:** Derive `health_ok` from issue counts or pass play snapshot into health builder.

---

### 🟠 M12 — API dashboard provider health flicker

**Files:** `admin-api-dashboard.ts:281-306`, `AdminApiDashboard.tsx:123-126`

**Bug:** `probe=false` sets `ok: false`; 8s telemetry refresh alternates with 120s probe — rings show unhealthy between probes.

**Fix:** `probe: null` when not run; separate telemetry from probe health.

---

### 🟠 M13 — 12h sessionStorage caches for desk/play/commentary

**Files:** `useMergedDesk.ts:15-17`, `useSpxPlay.ts:11-12`, `SpxCommentaryRail.tsx:19-20`

**Impact:** Post-close reload shows prior-session data until fresh polls (or forever if polling off).

**Fix:** Session-scope TTL; clear on `session_date` change.

---

### 🟠 M14 — Play UI decoupled from desk merge

**File:** `SpxTradeAlerts.tsx:20-25,196`

**Bug:** `desk` prop unused; play from isolated `/spx/play` poll — no client coherence with visible GEX/price.

**Fix:** Cross-check play levels vs desk or remove misleading prop.

---

### 🟠 M15 — Cache thundering herd (server + module caches)

**Files:** `server-cache.ts:59-87`, `spx-play-technicals.ts:136-140`, `spx-play-options.ts:120-129`, `spx-lotto-options.ts:109-117`

**Fix:** Inflight promise dedup on SWR gap and module caches.

---

### 🟠 M16 — Telemetry persists unsanitized bodies/snippets

**Files:** `api-telemetry.ts:164-166`, `api-telemetry-persist.ts:33-35`, `market-health.ts:63-70`

**Fix:** Scrub before persist; limit health API error exposure.

---

### 🟠 M17 — Multi-instance lotto/watch state races

**Files:** `spx-lotto-store.ts:44-72`, `spx-play-watch.ts:74-84`, `spx-lotto-outcomes.ts:5-14`

**Fix:** Same locking strategy as H5/H3.

---

### 🟡 L1 — `live` vs `sessionActive` hides valid premarket desk

**File:** `useMergedDesk.ts:126-131,35-38`

**Fix:** Separate `sessionActive` (poll) from `market_open` (display live badge).

---

### 🟡 L2 — `useLiveSpxTape` retains stale SSE rows when seed clears

**File:** `useLiveSpxTape.ts:14-17,29`

---

### 🟡 L3 — No React ErrorBoundary on desk/play/commentary subtree

**Grep:** zero matches under `src/`

---

### 🟡 L4 — Misleading offline UI (always-pulse dots, hardcoded GEX meter)

**Files:** `SpxDeskPanels.tsx:150-152`, `GexDealerPanel.tsx:23-27`, `SpxStructureBlocks.tsx:156`

---

### 🟡 L5 — `engine.ts` appends dashboard secret to URL query

**File:** `engine.ts:18-19`

---

### 🟡 L6 — `playClaudeGateEnabled` defaults on when Anthropic key set

**File:** `spx-play-config.ts:65-69`

---

### 🟡 L7 — Discord notify / Redis pubsub fail-open permanence

**Files:** `spx-play-notify.ts:47-51`, `redis-pubsub.ts:39-42`

---

### 🟡 L8 — Admin in-memory state (route errors, critical alerts) per-process

**Files:** `admin-route-errors.ts`, `admin-critical-alerts.ts`

---

### 🟡 L9 — `SpxLiveStrip` duplicate `useMergedDesk` if mounted alongside dashboard

**File:** `SpxLiveStrip.tsx:9` — docs-only today

---

### 🟡 L10 — E2E probe / analyze scripts may log secrets to stdout

**Files:** `e2e-spx-probe.mjs:180`, `analyze-api-usage.mjs` — dev/CI only

---

## Step 3 — Edge-case second pass

| Scenario | Result |
|----------|--------|
| Two Railway instances hit `spx-evaluate` same minute | ❌ Both run full eval — race on open play + meta (H1–H3) |
| Admin opens Live tab and leaves it | ❌ Evaluates every 10s — mutations + heartbeat noise (H6) |
| Premium user polls `/api/market/spx/play` during cron tick | ❌ Third concurrent mutator (H1) |
| Largo asks “what’s the play?” via `getSpxPlayState` | ❌ Fourth mutator during market hours (H1) |
| `insertOpenSpxPlay` 23505 on concurrent BUY | ❌ Returns existing id but still `recordBuy` (H2) |
| BUY → TRIM → BUY same session | ✅ Second BUY logs (cursor moved) — may be intended; M1 if undesired |
| BUY → SELL → BUY same session | ⚠️ Second BUY logs — no time-window dedup (M1) |
| Score 51 then 52 same action/direction | ✅ Same `signal_key` — no duplicate log (prior S1 fix confirmed) |
| THETA exit underwater | ❌ `was_loss: false` — re-entry lock skipped (M2) |
| Watch promote eligible in UI, fails adaptive | ⚠️ Threshold mismatch — confusing not unsafe (M3) |
| CPI string in macro_events all day | ⚠️ Blocks entire morning window (M4) |
| `probe=false` admin API refresh | ❌ All providers show unhealthy (M12) |
| Reload dashboard at 4:30pm ET | ❌ 12h cache shows morning BUY hero (C1) |
| Overnight SPA, pulse lane down at open | ❌ Sticky structure from yesterday (C2) |
| `CRON_SECRET` in Railway cron URL `?secret=` | ⚠️ Log leak surface (M8) |
| No `ADMIN_EMAILS`, no Clerk admin role | ✅ Fail-closed — all admin denied (B06-017) |
| `dbConfigured()` false in dev | ✅ In-memory play outcomes — per-process only |
| Claude timeout after budget increment | ⚠️ Budget consumed, no verdict (M9) |
| `consumeWatchRecord` with DB off | ❌ Consumed flag never persisted (H8) |
| Concurrent watch promotes | ❌ Double entry possible (H8 + H1) |
| Signal log `getMeta` then `insert` race | ❌ Duplicate rows (M1) |
| Premarket `sessionActive=true`, `market_open=false` | ⚠️ Desk data hidden (`live=false`) (L1) |
| Admin `syncAdminIncidents` on dashboard GET | ⚠️ Read path mutates DB (B06-031) |
| `spx-evaluate` outside 7–16 ET without `force=1` | ✅ Skipped with cron log |
| Play gates with `desk.market_open=false` | ✅ BUY blocked; open-play manage still runs |
| Promote with GEX oppose + high conflicts | ✅ Still blocked — promote does not strip GEX/conflict gates |
| `requireAdminApi` missing on new route | ⚠️ Lib builders would expose data — convention risk (B06-030) |

### Step 3 — additional edge notes

**Expiry-less / session-boundary play cache (C1):** `useSpxPlay` uses `sessionStorage` key without ET date suffix — a tab left open overnight can merge yesterday’s play into today’s first poll if direction unchanged (`mergePlayWithCache`).

**Admin confirm modal bypass (H6):** `ConfirmModal` exists (`AdminSpxDashboard.tsx:863`) but `useEffect` at `:848-852` auto-calls `load(true)` when `section === "live"` — bypasses operator intent.

**Cron health false green (M10):** Engine tick via admin live or market API can satisfy heartbeat freshness while `cron_job_runs` for `spx-evaluate` is stale — ops may miss broken scheduler.

---

## Cross-check — `complete-repo-bugs/AUDIT-SPX-Admin-Frontend.md`

| Prior item | Batch 06 status |
|------------|-----------------|
| **S1 signal dedup (score/headline jitter)** | ✅ **FIXED** — `providers/spx-signal-log.ts:29-30` stable `session\|action\|direction` key |
| **Weak cursor-only dedup + no DB unique** | 🟠 **OPEN** — M1; cursor consecutive-only; `insertSpxSignalLog` append-only |
| **SPX action routing sound** | ✅ **CONFIRMED** — `spx-signals.ts:357-372` symmetric thresholds |
| **Admin routes gated** | ✅ **CONFIRMED** — `admin-access.ts`; libs unguarded by design (B06-030) |
| **Signal logging gated market-open + BUY/SELL/TRIM** | ✅ **CONFIRMED** — `spx-signal-log.ts:52-53` |
| **admin/apis/rescan command exec safe** | ✅ Out of batch 06 file list; Batch 03 confirmed — no change |
| **No XSS / open CORS / eval** | ✅ Grep sweep — zero `dangerouslySetInnerHTML` in batch components |
| **Security headers (S2)** | Out of scope (Batch 07 `next.config.mjs`) — still pending |
| **Pending: spx-desk.ts signal-math line read** | Lives in Batch 02 (`providers/spx-desk.ts`) — `spx-signals.ts` routing audited here |
| **Pending: components/admin, desk, hooks** | ✅ **COMPLETE** this batch — 111/111 files |

---

## Finding counts

| Severity | Step 2 | Step 3 (new notes*) | Total open |
|----------|--------|----------------------|------------|
| Critical (C) | 2 | 0 | **2** |
| High (H) | 8 | 0 | **8** |
| Medium (M) | 17 | 0 | **17** |
| Low (L) | 10 | 3** | **10** |
| **Total actionable** | **37** | **3** | **37*** |

\*Step 3 table rows marked ❌/⚠️ map to existing Step 2 IDs — no duplicate IDs added.  
\*\*Step 3 prose adds 3 edge notes (overnight cache key, confirm bypass detail, false-green cron) folded into existing findings.

### Verified fixed (cross-batch / prior audit)

| Item | Status |
|------|--------|
| SPX signal key score/headline jitter (prior S1) | ✅ Fixed in `spx-signal-log.ts` |
| SPX action routing thresholds | ✅ Cleared |
| Admin auth on API routes | ✅ Cleared (Batch 03 + `admin-access.ts`) |
| One open play per session (partial unique) | ✅ Present in `db.ts` |

### Cleared / intentional / low blast radius

- `spx-play-lotto.ts` deprecated shim — maintenance only
- `SpxSniperBackdrop` / `spx-sniper-backdrops.ts` — cosmetic tint only
- `DeskPanel` / `DeskHeroTicker` — presentational; legacy `SpxState` path not mounted by `SpxDashboard`
- `scripts/analyze-api-usage.mjs` — admin-gated rescan helper; hardcoded `execFile` path (Batch 03)
- E2E probe treats 401 on `/spx/play` as pass without cron — correct

---

## Recommended fix order

1. **H1 + H3 + H5** — Single writer + advisory lock + serialized meta (stops race class).
2. **H6** — Stop admin Live auto-eval / polling (immediate ops safety).
3. **H2 + M6 + M7 + M1** — DB transactions + unique constraints + signal dedup.
4. **C1 + C2** — Client stale play + sticky structure (user-facing trading safety).
5. **H7 + M16** — Telemetry URL/body redaction.
6. **M2 + M3 + M4** — Engine correctness (THETA loss, promote UX, macro schedule).
7. **M10–M12** — Admin observability accuracy.
8. **M13–M17 + L1–L10** — Cache, UI polish, hardening.

---

## Files not finished

**None.** All **111 / 111** batch files read in full.
