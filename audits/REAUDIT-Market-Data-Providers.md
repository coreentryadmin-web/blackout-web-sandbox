# Re-Audit — Batch 02: Market Data Providers

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Market-Data-Providers.md`

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **P1** (flow cursor ISO) | ✅ **FIXED** | `flow-ingest.ts:62-69` — cursor uses `created_at` only (unchanged, still correct) |
| **P2** (WS stale skip) | ✅ **FIXED** | `flow-ingest.ts:29` + `uw-socket.ts:553-556` — `isUwChannelFresh("flow_alerts", 120_000)` |
| **P6** (prior-close breadth) | ✅ **FIXED** | SPX desk caller now wired — see **B2-01** |
| **P7** (near high/low rename) | ✅ **FIXED** | `polygon.ts:143-146`, consumers updated (unchanged) |
| **B2-01** | ✅ **FIXED** | `spx-desk.ts:929-941` — `fetchPriorDayCloses(today)` passed to `computeMarketBreadthFromSummary(..., priorCloses)` |
| **B2-02** | ❌ **OPEN** | `uw-socket.ts:412-418` — `hasActiveTradingHalt` still returns `false` on empty store; `lastMessageAt.trading_halts` not consulted; gates at `spx-play-gates.ts:88` unchanged |
| **B2-03** | ❌ **OPEN** | `spx-desk.ts:778` — `buildSpxDesk` still uses raw `fetchIndexSnapshots([...])` without `ensureDataSockets()` / `mergeWsIndexSnapshots`. Pulse/flow lanes merge WS at `:1111-1172`, `:1249-1284` |
| **S3-01** | ❌ **OPEN** | `spx-session.ts:83` — RTH filter still `<= 16 * 60` |
| **S3-02** | ❌ **OPEN** | `unusual-whales.ts:380-387` — error path serves unbounded stale market-flow cache |
| **S3-03** | ❌ **OPEN** | `macro-events.ts:188` — upcoming helper still `_2026` only |
| **S3-04** | ❌ **OPEN** | `greek-exposure-summary.ts:31` — UTC default `todayYmd` |
| **S3-05** | ❌ **OPEN** | Cursor non-advance when UW omits `created_at` (documented degraded mode) |

---

## Key fix verification

### B2-01 — SPX desk breadth uses prior close

```929:941:src/lib/providers/spx-desk.ts
      fetchPriorDayCloses(today).catch(() => ({})),
    ]);
  // ...
  const marketBreadth = dailyMarket?.results?.length
    ? computeMarketBreadthFromSummary(dailyMarket.results, priorCloses)
    : null;
```

Night Hawk path (`market-wide.ts:242-246`) unchanged and consistent.

### B2-02 — halt gate (still open)

No `isUwChannelFresh("trading_halts", …)` guard added to `hasActiveTradingHalt` or play/NH consumers.

### B2-03 — desk vs pulse price divergence (still open)

Full desk REST snapshots can lag pulse WS merge during fast tape.

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| — | — | — | No new production bugs found beyond original audit IDs |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 5 (P1, P2, P6, P7, B2-01) |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 8 (B2-02, B2-03, S3-01–S3-05) |
| 🆕 NEW | 0 |

**Recommended next:** B2-02 (halt fail-open) → B2-03 (desk WS merge parity).
