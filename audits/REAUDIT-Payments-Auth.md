# Re-Audit — Batch 01: Payments & Auth

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 (forensic re-audit after Phase 1 fixes)  
> **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Payments-Auth.md`  
> **Build:** `npm run build` passes (reported)

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **MED-1** | MEDIUM | ✅ **FIXED** | `SessionCacheGuard.tsx:10-26` — tracks `userId`; clears cache on sign-out **and** on `userId` change while signed in |
| **MED-2** | MEDIUM | ✅ **FIXED** | `src/app/docs/layout.tsx:5-6` — shared `requireTier("premium")` for root docs pages (`api-probe`, `system-analysis`, `claude-api-analysis`) |
| **MED-3** | MEDIUM | ✅ **FIXED** | `api/engine/[...path]/route.ts:24` — `authorizeCronOrTierApi(req, "premium")` (was `"free"`) |
| **LOW-1** | LOW | ❌ **OPEN** | `whop.ts:7-13` — `PREMIUM_MEMBERSHIP_STATUSES` still includes `past_due`, `canceling`, `trialing` (business-policy grace) |
| **LOW-2** | LOW | ❌ **OPEN** | `membership.ts:72-91` — missing `WHOP_COMPANY_ID` still falls back to unscoped list + email filter; no fail-fast |
| **LOW-3** | LOW | ❌ **OPEN** | `SyncMembershipButton.tsx:24-25` — still `router.refresh()` only; no Clerk `session.reload()` |

---

## Key fix verification

### MED-1 — session cache on account switch

```10:26:src/components/SessionCacheGuard.tsx
  const { isSignedIn, isLoaded, userId } = useAuth();
  // ...
    if (isSignedIn && userId && lastUserId.current && lastUserId.current !== userId) {
      clearAllSessionCache();
    }
    lastUserId.current = isSignedIn ? userId ?? null : null;
  }, [isSignedIn, isLoaded, userId]);
```

### MED-2 — docs premium gate

Root docs layout applies premium tier before any ungated page renders. Nested layouts (`polygon`, `unusual-whales`, `cursor-api-analysis`, `spx-sniper`) retain their own gates — redundant but safe.

### MED-3 — engine proxy tier

Engine allowlist unchanged; minimum tier now matches market desk routes.

---

## Prior audit reconciliation (unchanged)

| Item | Re-audit status |
|------|-----------------|
| Unauthenticated engine proxy | ✅ Still fixed |
| Client WS key removed | ✅ Still fixed (out of batch scope) |
| Whop webhook fail-closed without secret | ✅ Still fixed |
| Cron `?secret=` query string | ✅ **FIXED** in Batch 03/06 — `market-api-auth.ts:5-9` Bearer-only |

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| **PA-NEW-1** | LOW | `SyncMembershipButton.tsx:24-25` | Tier sync success still depends on JWT refresh latency for client-side `useAuth` metadata (same class as LOW-3; no regression) |

No new security regressions identified in Batch 01 scope.

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 3 |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 3 |
| 🆕 NEW | 1 (LOW, non-regression) |

**Batch 01 re-audit:** Phase 1 closed all MEDIUM findings. Remaining items are LOW / policy.
