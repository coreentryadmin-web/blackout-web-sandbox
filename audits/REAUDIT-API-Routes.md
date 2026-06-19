# Re-Audit — Batch 03: API Routes

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-API-Routes.md`

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **H1** | ✅ **FIXED** | `api/market/health/route.ts:9-17` — non-admin callers get minimal `{ ok, as_of }` only; full snapshot requires `requireAdminApi()` |
| **M1** | ✅ **FIXED** | All 5 cron routes use `isCronAuthorized(req)` from `market-api-auth.ts` (e.g. `cron/spx-evaluate/route.ts:9,16`) |
| **M2** | ✅ **FIXED** | `api/engine/[...path]/route.ts:24` — `"premium"` tier (cross-ref Payments MED-3) |
| **L1** | ❌ **OPEN** | `api/engine/health/route.ts` — still hints `NEXT_PUBLIC_API_BASE` when unconfigured |
| **L2** | ❌ **OPEN** | `api/market/flows/route.ts` — lazy `maybeRunFlowIngest()` on read (acceptable, unchanged) |
| **L3** | ❌ **OPEN** | `lotto/today`, `nighthawk/edition`, `nighthawk/play-explain`, `spx/play` — `requireDatabaseInProduction()` still before auth (e.g. `lotto/today/route.ts:17-20`) |
| **L4** | ❌ **OPEN** | Whop webhook secret unset → fail closed (documented; no code change needed) |

**Unguarded by design (cleared):** `api/engine/health`, `api/admin/me` — unchanged, acceptable.

---

## Key fix verification

### H1 — market health no longer leaks ops intel

```9:17:src/app/api/market/health/route.ts
/** Admin-only full ops snapshot — public callers get minimal liveness only. */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) {
    return NextResponse.json(
      { ok: true, as_of: new Date().toISOString() },
```

Anonymous / non-admin callers no longer receive DB pool, WS health, play-engine state, or telemetry.

### M1 — cron auth centralized

`isCronAuthorized` is Bearer-header-only (`market-api-auth.ts:5-9`); query-string `?secret=` removed.

### M2 — engine proxy premium

Aligned with `authorizeMarketDeskApi` product intent.

---

## Integration fixes (cross-batch, verified via routes)

| Path | Before | After |
|------|--------|-------|
| `GET /api/market/spx/play` | Called `evaluateSpxPlay` (mutating) | `readSpxPlaySnapshot` via `spx-evaluator.ts:55-59` — read-only |
| `GET /api/cron/spx-evaluate` | Direct eval, no lock | `runSpxEvaluator(..., "cron")` with advisory lock (`spx-evaluator.ts:27-51`) |

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| **API-NEW-1** | LOW | `api/market/health/route.ts:13-16`, `railway.toml:healthcheckPath` | Railway healthcheck hits `/api/market/health` without admin auth → always `{ ok: true }` even when DB/providers down. Deploy liveness no longer reflects real market health. Consider dedicated `/api/health` or admin-authenticated probe. |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 3 (H1, M1, M2) |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 4 (L1–L4) |
| 🆕 NEW | 1 (LOW) |

**Batch 03 re-audit:** All HIGH/MEDIUM route auth findings resolved.
