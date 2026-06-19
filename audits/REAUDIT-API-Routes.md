# Re-Audit Round 2 — Batch 03: API Routes

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-API-Routes.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **H1** | HIGH | ✅ **FIXED** | `market/health/route.ts:9-17` — non-admin gets `{ ok, as_of }` only |
| **M1** | MEDIUM | ✅ **FIXED** | All 5 cron routes use `isCronAuthorized(req)` |
| **M2** | MEDIUM | ✅ **FIXED** | `engine/[...path]/route.ts:24` — premium tier |
| **L1** | LOW | ✅ **FIXED** | `engine/health/route.ts:5-10` — generic unconfigured message |
| **L2** | LOW | ❌ **OPEN** | `market/flows/route.ts:12-22` — `maybeRunFlowIngest()` side-effect on read (gated behind premium auth; design observation) |
| **L3** | LOW | ✅ **FIXED** | Auth before `requireDatabaseInProduction` on lotto/play/nighthawk routes |
| **L4** | LOW | ✅ **FIXED** | `webhook/whop/route.ts:13-16` — explicit 503 when secret unset |

**Bonus:** `market-api-auth.ts:5-9` — cron secret Bearer-only (no `?secret=` query param).

**Deploy liveness (prior NEW):** `api/health/route.ts:7-19` + `railway.toml:7` — ✅ FIXED.

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 6 |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 1 |
| 🆕 NEW | 0 |
