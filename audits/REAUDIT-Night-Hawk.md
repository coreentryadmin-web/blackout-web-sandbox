# Re-Audit Round 2 — Batch 04: Night Hawk

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-Night-Hawk.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **NH-M1** | MEDIUM | ⚠️ **PARTIAL** | `hunt-mode.ts:69-96` + `hunt-builder.ts:66-92` — swing/leap filters wired at dossier prefilter; `max_entry_premium` compares wrong units (see NH-NEW-01); `filters.dte_max` not passed to Claude (`hunt-builder.ts:197-198`) |
| **NH-M2** | MEDIUM | ✅ **FIXED** | `hunt-builder.ts:172-173` — gates on `d.scored != null` (matches edition) |
| **NH-LM1** | LOW-MED | ✅ **FIXED** | `day-trade-filters.ts:44-56` — ambiguous direction rejected |
| **NH-L1** | LOW | ⚠️ **PARTIAL** | `embeds/NightHawkRadar.tsx:7-36` — subtitle says "demo visualization"; footer still shows "Scan active" |
| **NH-L2** | LOW | ✅ **FIXED** | `day-trade-filters.ts:83-100` — DTE filter for 0DTE and 1DTE |
| **NH-L3** | LOW | ✅ **FIXED** | `day-trade-filters.ts:90-92` — ET session date for DTE |
| **NH-L4** | LOW | ❌ **OPEN** | `day-trade-agent.ts:14` — phase always `CANDIDATE`; lifecycle never advances |
| **NH-L5** | LOW | ✅ **FIXED** | `AgentPowerModal.tsx:138` — `${play.ticker}-${play.contract ?? idx}` key |
| **NH-S3-EXP** | edge | ✅ **FIXED** | `option-chain-prompt.ts:305` — rejects null expiry |

**Prior fixes confirmed:** chain dedup, Jan rollover, skew double-count, tech-null edition drop, outcome intraday bias, flow limit 450, null premium reject.

---

## NEW findings

| ID | Severity | Status | Evidence |
|----|----------|--------|----------|
| **NH-NEW-01** | HIGH | 🆕 **NEW** | `hunt-builder.ts:40-44,88-91` — `flowPremium()` returns UW block premium ($50K+) compared to per-contract `max_entry_premium` cap ($5–15); default Swing filters likely yield **empty results** |
| **NH-NEW-02** | MEDIUM | 🆕 **NEW** | `hunt-builder.ts:197-206` — user `filters.dte_max` ignored; Claude uses `weights.maxDte` (30/90); no post-Claude DTE enforcement on `options_play` |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 6 |
| ⚠️ PARTIAL | 2 |
| ❌ OPEN | 1 |
| 🆕 NEW | 2 |
