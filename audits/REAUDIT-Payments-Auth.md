# Re-Audit Round 2 — Batch 01: Payments & Auth

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-Payments-Auth.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **MED-1** | MEDIUM | ✅ **FIXED** | `SessionCacheGuard.tsx:10-25` — tracks `userId`; clears cache on sign-out and account switch |
| **MED-2** | MEDIUM | ✅ **FIXED** | `src/app/docs/layout.tsx:4-7` — `requireTier("premium")` on all `/docs` routes |
| **MED-3** | MEDIUM | ✅ **FIXED** | `api/engine/[...path]/route.ts:24` — `authorizeCronOrTierApi(req, "premium")` |
| **LOW-1** | LOW | ❌ **OPEN** | `whop.ts:7-14` — `past_due` / `canceling` still grant premium; documented as intentional grace policy |
| **LOW-2** | LOW | ✅ **FIXED** | `membership.ts:72-75` — fail-fast when `WHOP_COMPANY_ID` unset |
| **LOW-3** | LOW | ✅ **FIXED** | `SyncMembershipButton.tsx:27-28` — `session?.reload()` before `router.refresh()` |

---

## Second pass (edge cases)

| Edge case | Result |
|-----------|--------|
| Account switch without sign-out | Cache cleared via `userId` tracking — no leak |
| Free user on `/docs/system-analysis` | Redirected by docs layout tier gate |
| Free user on engine proxy | 403 — premium tier required |
| Whop webhook unsigned | SDK unwrap fails; route returns 400/503 |

No new bugs found in Batch 01 scope.

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 5 |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 1 |
| 🆕 NEW | 0 |
