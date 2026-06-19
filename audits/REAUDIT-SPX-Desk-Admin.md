# Re-Audit Round 2 — Batch 06: SPX Desk + Admin

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-SPX-Desk-Admin.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Critical / High finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **C1** | CRITICAL | ✅ **FIXED** | `useSpxPlay.ts:125-129,177` — clears cache when `!sessionActive`; `SpxTradeAlerts.tsx:211` gates hero |
| **C2** | CRITICAL | ✅ **FIXED** | `spx-desk-merge.ts:64-119` — `STRUCTURE_TTL_MS`, session-date reset via `resetSpxDeskMergeCache()` |
| **H1** | HIGH | ⚠️ **PARTIAL** | Play: `spx-evaluator.ts:27-51` advisory lock + single writer. **Lotto still mutates from GET** — `lotto/today/route.ts:34` calls `evaluateSpxLotto` without lock |
| **H2** | HIGH | ✅ **FIXED** | `db.ts:891-936` transactional close+insert; `spx-play-engine.ts:808-827` skips notify when `!created` |
| **H3** | HIGH | ✅ **FIXED** | `spx-evaluator.ts:34-37` + `db.ts:599-606` `pg_try_advisory_lock`; cron uses `runSpxEvaluator` |
| **H4** | HIGH | ✅ **FIXED** | `play-engine-heartbeat.ts:36-54` — persisted to `platform_meta` |
| **H5** | HIGH | ⚠️ **PARTIAL** | `spx-play-store.ts:115-142` — version merge + retry; not atomic `jsonb_set`; mitigated by H3 lock in prod |
| **H6** | HIGH | ✅ **FIXED** | `AdminSpxDashboard.tsx:836-865` — live eval requires ConfirmModal; no auto-poll |
| **H7** | HIGH | ✅ **FIXED** | `AdminApiEventDetail.tsx:117` + `api-telemetry-persist.ts:8-9` — sanitized URLs/bodies |
| **H8** | HIGH | ✅ **FIXED** | `spx-play-watch.ts:86-99` — load, persist consumed, then clear memory |

---

## Medium finding status

| ID | Status | Evidence |
|----|--------|----------|
| **M1** | ✅ **FIXED** | `db.ts:175-176` `UNIQUE(signal_key)`; `:753` `ON CONFLICT DO NOTHING` |
| **M2** | ✅ **FIXED** | `spx-play-engine.ts:320-327` — theta loss from `pnlPts` |
| **M3** | ✅ **FIXED** | `spx-play-engine.ts:521,555` — `effectivePromoteMinScore` as `fullMinScore` |
| **M4** | ✅ **FIXED** | `spx-play-gates.ts:34-79` — event-time macro windows |
| **M5** | ✅ **FIXED** | `spx-play-engine.ts:829-855` — `recordPlayEntry` awaited |
| **M6** | ✅ **FIXED** | `db.ts:248-249` partial unique on open outcomes; `:1044` `ON CONFLICT DO NOTHING` |
| **M7** | ✅ **FIXED** | `db.ts:288-289` unique `(session_date, pick_index)`; `:1328` `ON CONFLICT DO NOTHING` |
| **M8** | ✅ **FIXED** | `market-api-auth.ts:5-9` — Bearer-only cron secret |
| **M9** | ⚠️ **PARTIAL** | `spx-play-claude.ts:105-129` multi-slot cache; budget races across replicas possible |
| **M10** | ⚠️ **PARTIAL** | `admin-cron-health.ts:144` — 48-run global cap can undercount per-job `runs_24h` |
| **M11** | ⚠️ **PARTIAL** | `admin-spx-issues.ts:320` improved; `admin-health.ts:36` still passes `play: null` |
| **M12** | ✅ **FIXED** | `admin-api-dashboard.ts:283-306` — `probe.ok: null` when probe not run |
| **M13** | ✅ **FIXED** | `session-cache.ts:35-61` — ET date-scoped keys |
| **M14** | ❌ **OPEN** | `SpxTradeAlerts.tsx:196` — `desk` prop declared but unused |
| **M15** | ⚠️ **PARTIAL** | `server-cache.ts:55-86` inflight dedup; `spx-play-technicals.ts:136-139` module cache no dedup |
| **M16** | ⚠️ **PARTIAL** | Persist/display sanitized; `api-telemetry.ts:164-166` in-memory ring stores raw URLs |
| **M17** | ⚠️ **PARTIAL** | Play serialized via lock; lotto races from cron + admin + `GET /lotto/today` |

---

## Low finding status

| ID | Status | Evidence |
|----|--------|----------|
| **L1** | ⚠️ **PARTIAL** | `useMergedDesk.ts:136-141` — `live` requires `sessionActive && market_open`; premarket desk hidden |
| **L2** | ❌ **OPEN** | `useLiveSpxTape.ts:14-17` — stale tape not cleared when seed empties |
| **L3** | ❌ **OPEN** | Zero `ErrorBoundary` under `src/` (prior REAUDIT claim incorrect) |
| **L4** | ❌ **OPEN** | `SpxDeskPanels.tsx:27` — pulse dot regardless of live state |
| **L5** | ❌ **OPEN** | `engine.ts:18-19` — `DASHBOARD_API_SECRET` in URL query |
| **L6** | ❌ **OPEN** | `spx-play-config.ts:65-69` — Claude gate defaults on when key set |
| **L7** | ❌ **OPEN** | Discord/Redis fail-open (intentional ops policy) |
| **L8** | ❌ **OPEN** | `admin-route-errors.ts` / `admin-critical-alerts.ts` — per-process memory |
| **L9** | ❌ **OPEN** | `SpxLiveStrip.tsx:9` — duplicate `useMergedDesk` if co-mounted |
| **L10** | ❌ **OPEN** | `e2e-spx-probe.mjs:331` — logs key presence (dev/CI) |

---

## NEW findings

| ID | Severity | Status | Evidence |
|----|----------|--------|----------|
| **R2-NEW-1** | HIGH | 🆕 **NEW** | `lotto/today/route.ts:34` — side-effecting GET writes lotto state without advisory lock (same class as original H1 for play) |

---

## Challenge to prior "0 OPEN" claim

Phase 3 REAUDIT marked L1–L10 and M14 all FIXED — **not supported** at `d171c68`. Critical play-path fixes (C1/C2, H2–H4, H6–H8, M1/M6/M7) hold. Lotto mutator and LOW-tier items remain.

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 22 |
| ⚠️ PARTIAL | 9 |
| ❌ OPEN | 8 |
| 🆕 NEW | 1 |
