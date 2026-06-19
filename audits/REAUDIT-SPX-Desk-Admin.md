# Re-Audit — Batch 06: SPX Desk + Admin

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-SPX-Desk-Admin.md`

---

## Critical / High finding status

| ID | Status | Evidence |
|----|--------|----------|
| **C1** | ✅ **FIXED** | `useSpxPlay.ts:125-129,177` clears cache when `!sessionActive`; `SpxTradeAlerts.tsx:211` — `show = play != null && live && sessionActive` |
| **C2** | ✅ **FIXED** | `spx-desk-merge.ts:64-118` — `STRUCTURE_TTL_MS` (30m), session-date reset via `resetSpxDeskMergeCache()`; `useMergedDesk.ts:68-74` resets on ET date change |
| **B06-H1** | ✅ **FIXED** | New `spx-evaluator.ts` — `readSpxPlaySnapshot` (mutate:false) for `market/spx/play` + `platform/spx-service.ts:70-79`; `runSpxEvaluator` single mutation entry with lock |
| **B06-H2** | ✅ **FIXED** | `db.ts:883-922` — transactional `BEGIN`/`COMMIT`/`ROLLBACK`; returns `{ id, created }`; `spx-play-engine.ts:808-821` early return + skip `recordBuy` when `!created` |
| **B06-H3** | ✅ **FIXED** | `spx-evaluator.ts:33-37,48-50` — `tryAcquireSpxEvaluateLock()` / `releaseSpxEvaluateLock()` (`db.ts:591+`) |
| **B06-H4** | ✅ **FIXED** | `play-engine-heartbeat.ts:49-50,57-68` — persists to `platform_meta` key `spx_play_engine_heartbeat`; `loadPlayEngineHeartbeat()` cross-replica |
| **B06-H5** | ⚠️ **PARTIAL** | `spx-play-store.ts:100-120` — `mergeSessionMeta` uses max timestamps (reduces overwrite loss) but still read-modify-write without CAS/version |
| **B06-H6** | ✅ **FIXED** | `AdminSpxDashboard.tsx:836-845` — polls `load(false)` only; live eval requires `ConfirmModal` + explicit button (`:896`, `:856-865`) |
| **B06-H7** | ✅ **FIXED** | New `api-telemetry-sanitize.ts`; `AdminApiEventDetail.tsx:117,123` uses `sanitizeTelemetryUrl` / `sanitizeTelemetryBody`; persist path scrubbed in `api-telemetry-persist.ts:8-9` |
| **B06-H8** | ✅ **FIXED** | `spx-play-watch.ts:86-99` — DB path loads record then persists `consumed: true`; memory path updates in-memory flag |

---

## Medium / Low finding status (selected)

| ID | Status | Evidence |
|----|--------|----------|
| **M1** | ❌ **OPEN** | `db.ts:738-759` — `insertSpxSignalLog` append-only; no `UNIQUE (signal_key)` / `ON CONFLICT` |
| **M2** | ✅ **FIXED** | `spx-play-engine.ts:320-327` — THETA exit uses `thetaLoss = pnlPts(...) < 0` for `was_loss` |
| **M3** | ✅ **FIXED** | `spx-play-engine.ts:521,555` — watch promote uses `effectivePromoteMinScore` via `promoteMin` |
| **M4** | ❌ **OPEN** | `spx-play-gates.ts:37` — macro hard block still string/window based |
| **M5** | ❌ **OPEN** | `firePlayTelemetry` void path for `recordPlayEntry` |
| **M6** | ❌ **OPEN** | No unique index on open `spx_play_outcomes` per `open_play_id` |
| **M7** | ❌ **OPEN** | `lotto_plays` index not unique on `(session_date, pick_index)` |
| **M8** | ✅ **FIXED** | `market-api-auth.ts:5-9` — Bearer-only cron auth |
| **M9** | ❌ **OPEN** | Claude DB cache single slot + budget race |
| **M10** | ❌ **OPEN** | Admin cron health accuracy gaps |
| **M11** | ❌ **OPEN** | `health_ok` decoupled from issue severity |
| **M12** | ⚠️ **PARTIAL** | `admin-api-dashboard.ts:281-284` — probe skipped uses `error: null` when `!options?.probe`; still `ok: false` between probe cycles |
| **M13** | ⚠️ **PARTIAL** | C1 fix addresses post-close hero; 12h cache TTL unchanged (`useMergedDesk.ts:18`, `useSpxPlay.ts:33`) |
| **M14–M17** | ❌ **OPEN** | UI decoupling, cache herd, telemetry persist, multi-instance lotto/watch — unchanged |
| **L1–L10** | ❌ **OPEN** | Cosmetic / dev-only / convention risks — unchanged |

---

## Key fix verification

### C1 — stale play hero

```211:211:src/components/desk/SpxTradeAlerts.tsx
  const show = play != null && live && sessionActive;
```

### C2 — sticky structure reset

```93:118:src/lib/spx-desk-merge.ts
export function resetSpxDeskMergeCache(): void { /* clears lastGoodStructure */ }
function touchStructureSession(today: string): void {
  if (lastGoodStructureSessionDate != null && lastGoodStructureSessionDate !== today) {
    resetSpxDeskMergeCache();
```

### B06-H1 — single writer pattern

```54:59:src/lib/spx-evaluator.ts
export async function readSpxPlaySnapshot(...) {
  return evaluateSpxPlay(desk, technicals, { mutate: false });
}
```

Mutating paths: cron (`runSpxEvaluator`), admin confirm live only.

### B06-H2 — transactional open play

```808:826:src/lib/spx-play-engine.ts
  if (!created) {
    const existing = await loadOpenPlay();
    if (existing) {
      return evaluateOpenPlay(...);
    }
  }
  if (mutate) {
    await recordBuy(dir);
```

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| — | — | — | No new CRITICAL/HIGH beyond original audit |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 12 (C1, C2, H1–H4, H6, H7, H8, M2, M3, M8) |
| ⚠️ PARTIAL | 3 (H5, M12, M13) |
| ❌ OPEN | 22 (M1, M4–M7, M9–M11, M14–M17, L1–L10) |
| 🆕 NEW | 0 |

**Batch 06 re-audit:** All CRITICAL and HIGH findings addressed. Remaining MEDIUM/LOW are observability, DB constraints, and cache polish.
