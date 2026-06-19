# Re-Audit — Batch 05: Largo AI

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Largo-AI.md`

---

## Prior fixes (re-verified)

| Item | Status |
|------|--------|
| `extractTicker` false positives | ✅ **FIXED** |
| Prompt caching | ✅ **FIXED** |
| LRU session cap | ✅ **FIXED** |
| Shared intent keywords | ✅ **FIXED** |
| Unknown tool graceful error | ✅ **FIXED** |

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **B5-01** | ✅ **FIXED** | `largo-live-feed.ts:40-41` — `scopeTicker = intent.tickerHint ?? (intent.needsSpxDesk ? "SPX" : null)`; no default `"SPX"` on generic questions |
| **B5-02** | ✅ **FIXED** | `largo-live-feed.ts:43-92` — prefetch driven by intent flags (`needsNews`, `needsSpxDesk`, `needsFlow`, `needsPlayState`, `scopeTicker`); base job is only `get_market_context` |
| **B5-03** | ❌ **OPEN** | `anthropic.ts:202-267` — tool loop exhaustion still returns `extractTextFromLastAssistant`; no final no-tools synthesis turn |
| **B5-04** | ❌ **OPEN** | `intent-keywords.ts:13-14` — `PLAY_STATE_RE` still matches `analysis`, `outlook`, etc. |
| **B5-05** | ❌ **OPEN** | `embeds/LargoWorkspace.tsx:5,13` — still imports root `LargoTerminal` (blocking JSON), not `desk/LargoTerminal` (SSE) |
| **B5-06** | ❌ **OPEN** | `technicals.ts:44` — `buildLargoTechnicals` exported, never called from `run-tool.ts` |
| **B5-07** | ❌ **OPEN** | `anthropic.ts:206` — `TEMPERATURE = 0.3` hardcoded in tool loop |
| **B5-08** | ❌ **OPEN** | `run-tool.ts:675` — empty `forTicker` still falls back to `rows.slice(0, 10)` global screener |
| **S3-01** | ❌ **OPEN** | Stream error duplicate bubble — `desk/LargoTerminal.tsx` |
| **S3-02** | ❌ **OPEN** | In-memory sessions not user-scoped without Postgres |
| **S3-03** | ❌ **OPEN** | Multi-ticker first-match pinning |
| **S3-04** | ❌ **OPEN** | `NON_TICKER_CAPS` incomplete |
| **S3-05** | ❌ **OPEN** | Redundant desk reload after feed capture |
| **S3-06** | ❌ **OPEN** | Dead `get_vol_anomaly` handler |
| **S3-07** | ❌ **OPEN** | User message persisted before assistant success |
| **S3-08** | ❌ **OPEN** | `tool_start` SSE not shown in desk UI |

---

## Key fix verification

### B5-01 / B5-02 — intent-scoped prefetch

```39:92:src/lib/largo/largo-live-feed.ts
export async function captureLargoLiveFeed(intent: LargoQuestionIntent): Promise<LargoLiveFeed> {
  const scopeTicker = intent.tickerHint ?? (intent.needsSpxDesk ? "SPX" : null);
  const jobs: Array<{ key: FeedKey; promise: Promise<unknown> }> = [
    { key: "market", promise: safeTool("get_market_context") },
  ];
  if (intent.needsNews) { /* calendar */ }
  if (intent.needsSpxDesk || scopeTicker === "SPX") { /* spx_structure */ }
  if (scopeTicker) { /* ticker-scoped tools */ }
  // ... conditional blocks only
```

Generic macro questions no longer auto-pull full SPX desk bundle.

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| — | — | — | No new findings beyond original IDs |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 2 (B5-01, B5-02) + 5 prior verified |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 15 (B5-03–B5-08, S3-01–S3-08) |
| 🆕 NEW | 0 |

**Recommended next:** B5-03 (exhaustion answer) → B5-05 (embed terminal parity) → B5-08 (analyst ratings).
