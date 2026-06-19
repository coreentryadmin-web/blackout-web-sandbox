# Re-Audit Round 2 — Batch 02: Market Data Providers

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-Market-Data-Providers.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **P1** | — | ✅ **FIXED** | `flow-ingest.ts:71-78` — cursor uses `created_at` only |
| **P2** | — | ✅ **FIXED** | `flow-ingest.ts:27-32` + `uw-socket.ts:553-556` — `isUwChannelFresh("flow_alerts", 120_000)` |
| **P6** | — | ✅ **FIXED** | `spx-desk.ts:934-946` — `fetchPriorDayCloses` wired into breadth |
| **P7** | — | ✅ **FIXED** | `polygon.ts:143-146` — `closed_near_high` / `closed_near_low` |
| **B2-01** | MEDIUM | ✅ **FIXED** | Same prior-close breadth wiring as P6 |
| **B2-02** | MEDIUM | ⚠️ **PARTIAL** | `spx-play-gates.ts:110-115` fail-closed via `shouldBlockForTradingHalt`; `dossier.ts:266` still uses `hasActiveTradingHalt` (fail-open when channel stale) |
| **B2-03** | MEDIUM | ✅ **FIXED** | `spx-desk.ts:758-759,794` — `ensureDataSockets()` + `mergeWsIndexSnapshots` |
| **S3-01** | LOW | ✅ **FIXED** | `spx-session.ts:83` — RTH `< 16*60` |
| **S3-02** | LOW | ✅ **FIXED** | `unusual-whales.ts:253,384-393` — 30m max stale |
| **S3-03** | LOW | ✅ **FIXED** | `macro-events.ts` — `ALL_MACRO_SCHEDULE` includes 2027+ |
| **S3-04** | LOW | ✅ **FIXED** | `greek-exposure-summary.ts:31-33` — ET default date |
| **S3-05** | LOW | ✅ **FIXED** | `flow-ingest.ts:58-62,77-78` — numeric cursor fallback |

---

## NEW findings

| ID | Severity | Status | Evidence |
|----|----------|--------|----------|
| **B2-NEW-01** | MEDIUM | 🆕 **NEW** | `dossier.ts:266` → `scorer.ts:396-411` — Night Hawk halt check fail-open when UW `trading_halts` channel stale (residual B2-02) |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 11 |
| ⚠️ PARTIAL | 1 |
| ❌ OPEN | 0 |
| 🆕 NEW | 1 |
