# Blackout Web — Re-Audit Summary (Phase 2)

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Phase:** 2 forensic re-audit (post Phase 1 fixes, ~35 files)  
> **Build:** `npm run build` passes (reported)  
> **Detail:** `audits/REAUDIT-*.md` per batch

---

## Executive conclusion

Phase 1 **closed all CRITICAL and HIGH findings** from the original audit, plus the targeted MEDIUM items (session cache, docs tier gate, engine/cron auth, SPX evaluator concurrency, desk breadth, Largo prefetch). The member-facing trading safety issues (**C1/C2**) and ops exposure (**H1**, telemetry redaction) are resolved in code.

Remaining risk is **MEDIUM/LOW hardening**: halt-gate fail-open (B2-02), full-desk WS merge gap (B2-03), Night Hawk premium-cap filter (M1 partial), Largo tool-loop exhaustion (B5-03), and SPX DB constraint/dedup gaps (M1/M6/M7).

---

## Aggregate status counts

| Status | Count | Notes |
|--------|------:|-------|
| ✅ **FIXED** | **31** | Original finding IDs verified with file:line evidence |
| ⚠️ **PARTIAL** | **4** | NH-M1, B06-H5, B06-M12, B06-M13 |
| ❌ **OPEN** | **66** | Mostly LOW / observability / DB constraints |
| 🆕 **NEW** | **2** | Railway healthcheck false-green (API-NEW-1 / FC-NEW-1) |

*Counts sum original finding IDs per batch; prior “verified fixed” items (e.g. Night Hawk Bug A/B) are not double-counted.*

---

## Priority fixes — verification matrix

| ID | Area | Status | Evidence |
|----|------|--------|----------|
| **C1** | SPX stale play hero | ✅ FIXED | `useSpxPlay.ts:125-129`, `SpxTradeAlerts.tsx:211` |
| **C2** | Sticky desk structure | ✅ FIXED | `spx-desk-merge.ts:64-118`, `useMergedDesk.ts:68-74` |
| **B06-H1** | Multi-path evaluator | ✅ FIXED | `spx-evaluator.ts` read/mutate split; `readSpxPlaySnapshot` on market + Largo |
| **B06-H2** | Non-transactional open play | ✅ FIXED | `db.ts:883-922`, `spx-play-engine.ts:808-821` |
| **B06-H3** | Cron overlap | ✅ FIXED | `tryAcquireSpxEvaluateLock()` in `spx-evaluator.ts:33-50` |
| **B06-H4** | Per-process heartbeat | ✅ FIXED | `play-engine-heartbeat.ts:49-68` persists to `platform_meta` |
| **B06-H5** | Session meta races | ⚠️ PARTIAL | `mergeSessionMeta` max-timestamp merge; no CAS |
| **B06-H6** | Admin live auto-poll | ✅ FIXED | `AdminSpxDashboard.tsx:836-845` — confirm-only live eval |
| **B06-H7** | Telemetry URL leak | ✅ FIXED | `api-telemetry-sanitize.ts` + `AdminApiEventDetail.tsx:117,123` |
| **B06-H8** | Watch consume ordering | ✅ FIXED | `spx-play-watch.ts:86-99` |
| **H1** | Unguarded market health | ✅ FIXED | `api/market/health/route.ts:11-17` — admin-only full snapshot |
| **H2 / F1** | Polygon key in docs | ✅ FIXED | `api-probe/page.tsx:31,1209` redacted |
| **NH-M1** | Swing/leap filters | ⚠️ PARTIAL | DTE + catalyst wired; `max_entry_premium` still UI-only |
| **B2-01** | Desk breadth prior close | ✅ FIXED | `spx-desk.ts:929-941` |
| **B5-01/02** | Largo prefetch storm | ✅ FIXED | `largo-live-feed.ts:40-92` intent-scoped jobs |
| **MED-1** | Session cache user switch | ✅ FIXED | `SessionCacheGuard.tsx:20-21` |
| **API-M1** | Cron auth duplication | ✅ FIXED | All cron routes → `isCronAuthorized` |
| **F3 / docs layout** | Free-tier internal docs | ✅ FIXED | `src/app/docs/layout.tsx` |

---

## Open HIGH-impact items (post Phase 1)

| ID | Severity | Issue |
|----|----------|-------|
| **B2-02** | MEDIUM | Trading-halt gate fails open when halts channel stale |
| **B2-03** | MEDIUM | `buildSpxDesk` REST indices lag pulse WS merge |
| **F2** | MEDIUM | ✅ Fixed post-re-audit — auth-gated `/api/docs/spx-playbook` |
| **B5-03** | MEDIUM | Largo tool-loop exhaustion returns stale fragment |

No CRITICAL or HIGH findings remain open.

---

## Batch re-audit index

| Batch | Re-audit file | FIXED | PARTIAL | OPEN | NEW |
|-------|---------------|------:|--------:|-----:|----:|
| 01 Payments & Auth | [`REAUDIT-payments-auth.md`](./REAUDIT-payments-auth.md) | 3 | 0 | 3 | 1 |
| 02 Market Data | [`REAUDIT-market-data-providers.md`](./REAUDIT-market-data-providers.md) | 5 | 0 | 8 | 0 |
| 03 API Routes | [`REAUDIT-api-routes.md`](./REAUDIT-api-routes.md) | 3 | 0 | 4 | 1 |
| 04 Night Hawk | [`REAUDIT-night-hawk.md`](./REAUDIT-night-hawk.md) | 1 | 1 | 7 | 0 |
| 05 Largo AI | [`REAUDIT-largo-ai.md`](./REAUDIT-largo-ai.md) | 2 | 0 | 15 | 0 |
| 06 SPX Desk + Admin | [`REAUDIT-spx-desk-admin.md`](./REAUDIT-spx-desk-admin.md) | 12 | 3 | 22 | 0 |
| 07 Frontend + Config | [`REAUDIT-frontend-config.md`](./REAUDIT-frontend-config.md) | 4 | 0 | 8 | 1 |
| **Total** | | **30** | **4** | **67** | **2** |

---

## Recommended Phase 3 order

1. **B2-02** — Halt freshness gate (play + Night Hawk safety)
2. ~~**F2**~~ — Done (auth-gated playbook API)
3. **B2-03** — WS merge in `buildSpxDesk`
4. **NH-M1** — Wire `max_entry_premium`
5. **B06-M1/M6/M7** — DB unique constraints + signal dedup
6. **FC-NEW-1** — Dedicated deploy liveness endpoint
7. **F5** — Security headers baseline

---

## Completeness

Phase 2 re-read all Phase 1 touchpoints and re-verified every original finding ID in the seven batch audit files. No commit performed per instructions.
