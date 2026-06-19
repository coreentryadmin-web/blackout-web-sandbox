# Blackout Web — Re-Audit Round 2 Summary

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68` (`d171c685c9b6a60394330174dabb7dcae621ceb7`)  
> **Method:** Forensic re-read of all original finding IDs + edge-case second pass  
> **Detail:** `audits/REAUDIT-*.md` per batch

---

## Build verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ Pass |
| `npm run build` | ✅ Pass (compile + typecheck + static generation) |

---

## Executive conclusion

Round 2 **challenges the prior Phase 3 claim of 0 OPEN**. P2/P3 fixes successfully closed the **critical SPX play path** (C1/C2, evaluator lock, DB dedup constraints, stale UI, auth hardening, deploy liveness). However, **17 original findings remain OPEN or PARTIAL**, plus **5 NEW bugs** — most notably a **HIGH-severity Swing Hawk `max_entry_premium` unit mismatch** and a **lotto side-effecting GET** without write lock.

No CRITICAL findings remain open. **2 HIGH** issues are new or partial regressions.

---

## Aggregate status counts (original finding IDs)

| Status | Count | Notes |
|--------|------:|-------|
| ✅ **FIXED** | **59** | Critical play path + auth + most provider fixes verified |
| ⚠️ **PARTIAL** | **15** | Halt fail-open in NH dossier, NH-M1 filters, lotto mutator, H5 meta, admin ops |
| ❌ **OPEN** | **17** | Mostly LOW-tier UX/ops; F7 `strict: false`; Largo Step 3 items |
| 🆕 **NEW** | **5** | 1 HIGH (NH premium units), 1 HIGH (lotto GET), 3 MEDIUM/LOW |
| ℹ️ **INFO** | **2** | F8 Railway liveness, F9 public env vars |

*Prior Phase 3 REAUDIT claimed 103 FIXED / 0 OPEN — overstated by ~44 items.*

---

## Counts by severity (remaining: PARTIAL + OPEN + NEW)

| Severity | ✅ FIXED | ⚠️ PARTIAL | ❌ OPEN | 🆕 NEW |
|----------|--------:|-----------:|--------:|-------:|
| CRITICAL | 2 | 0 | 0 | 0 |
| HIGH | 6 | 2 | 0 | 2 |
| MEDIUM | 14 | 6 | 0 | 2 |
| LOW / edge | 37 | 7 | 17 | 1 |
| INFO | — | — | — | — |

---

## Batch re-audit index

| Batch | Re-audit file | FIXED | PARTIAL | OPEN | NEW |
|-------|---------------|------:|--------:|-----:|----:|
| 01 Payments & Auth | [`REAUDIT-Payments-Auth.md`](./REAUDIT-Payments-Auth.md) | 5 | 0 | 1 | 0 |
| 02 Market Data | [`REAUDIT-Market-Data-Providers.md`](./REAUDIT-Market-Data-Providers.md) | 11 | 1 | 0 | 1 |
| 03 API Routes | [`REAUDIT-API-Routes.md`](./REAUDIT-API-Routes.md) | 6 | 0 | 1 | 0 |
| 04 Night Hawk | [`REAUDIT-Night-Hawk.md`](./REAUDIT-Night-Hawk.md) | 6 | 2 | 1 | 2 |
| 05 Largo AI | [`REAUDIT-Largo-AI.md`](./REAUDIT-Largo-AI.md) | 9 | 2 | 6 | 1 |
| 06 SPX Desk + Admin | [`REAUDIT-SPX-Desk-Admin.md`](./REAUDIT-SPX-Desk-Admin.md) | 22 | 9 | 8 | 1 |
| 07 Frontend + Config | [`REAUDIT-Frontend-Config.md`](./REAUDIT-Frontend-Config.md) | 6 | 1 | 1 | 0 |
| **Total** | | **59** | **15** | **17** | **5** |

---

## Top 5 remaining issues (priority order)

1. **NH-NEW-01 (HIGH)** — `max_entry_premium` compares UW block premium ($50K+) to per-contract cap ($5–15) in `hunt-builder.ts:88-91`. Default Swing Hawk filters likely return zero candidates.

2. **R2-NEW-1 / H1 partial (HIGH)** — `GET /api/market/lotto/today` calls `evaluateSpxLotto` (`lotto/today/route.ts:34`) without advisory lock. Play engine lock does not cover lotto writes.

3. **NH-NEW-02 / NH-M1 partial (MEDIUM)** — User `filters.dte_max` not passed to Claude edition generation; post-Claude DTE enforcement missing for swing/leap.

4. **F2 partial (MEDIUM)** — Playbook gated route reads `private/docs/SPX-Sniper-Playbook.docx` but artifact absent from repo/build (`api/docs/spx-playbook/route.ts:7-11`).

5. **B2-02 partial / B2-NEW-01 (MEDIUM)** — Night Hawk dossier uses fail-open `hasActiveTradingHalt` (`dossier.ts:266`) while SPX play gates fail-closed via `shouldBlockForTradingHalt`.

---

## Key verifications vs prior REAUDIT

| Claim | Round 2 verdict |
|-------|----------------|
| 0 OPEN across all batches | ❌ **17 OPEN** + **15 PARTIAL** |
| F7 `strict: true` | ❌ **`strict: false`** at `tsconfig.json:10` |
| L1–L10 all fixed | ❌ L2–L10 largely still open; no ErrorBoundary |
| NH-M1 fixed (`max_entry_premium`) | ⚠️ **PARTIAL** — wired but unit mismatch breaks filter |
| B2-02 halt fail-closed | ⚠️ **PARTIAL** — play gates only; NH dossier fail-open |
| API-NEW-1 deploy liveness | ✅ `/api/health` + `railway.toml` |
| C1/C2 stale play/structure | ✅ Fixed |
| M1/M6/M7 DB dedup | ✅ Fixed |

---

## Regressions from P2/P3 fixes

| Area | Issue |
|------|-------|
| NH swing filters | `max_entry_premium` server-side filter introduced with wrong unit semantics — functional regression risk |
| REAUDIT accuracy | F7 and bulk L-items marked fixed without code verification |

No regressions detected in SPX play evaluator lock, DB constraints, or auth hardening paths.
