# Audit — API Route Authorization Matrix

Method: enumerated all 42 `app/api/**/route.ts`; grepped each for an auth guard
(`requireTierApi` / `authorizeCronOrTierApi` / `authorizeMarketDeskApi` /
`requireAdminApi` / inline cron-secret / Clerk `auth()`). Middleware does NOT
protect `/api`, so each route must self-authorize.

## Authorization status

| Route | Guard | Status |
|-------|-------|--------|
| api/engine/[...path] | **NONE** | 🔴 CRITICAL — see Payments-Auth #1 (open credentialed proxy) |
| api/engine/health | none | ✅ health check, no sensitive data (verify it returns no secrets) |
| api/market/health | none | ✅ health check (verify) |
| api/admin/* (analytics, apis/*, cron-health, health, incidents, nighthawk/*, spx/dashboard) | requireAdminApi | ✅ admin-gated |
| api/admin/me | getAdminStatus | ✅ returns caller's own status only |
| api/cron/flow-ingest | inline cron secret | ✅ guarded (inline, not via helper) |
| api/cron/largo-cleanup, nighthawk-edition, nighthawk-outcomes, spx-evaluate | cron secret | ✅ |
| api/market/largo/query | premium guard | ✅ (important — expensive Claude calls gated) |
| api/market/largo/session | guard | ✅ |
| api/market/nighthawk/{edition,hunt,play-explain} | premium | ✅ |
| api/market/spx/* (commentary, desk, flow, merged, outcomes, play, pulse, pulse/stream, signals) | premium/desk | ✅ |
| api/market/{flows,flows/stream,heatmap,indices,news,lotto/today,platform/snapshot} | guard present | ✅ |
| api/membership/sync | auth() own-email | ✅ |
| api/webhook/whop | signature verify | ✅ (see Payments-Auth #3 for unset-secret edge) |

## Findings

### 🔴 CRITICAL — api/engine/[...path]
Full writeup in `AUDIT-Payments-Auth.md` #1. Only route with no gate that
proxies to an internal service with server credentials.

### 🟡 LOW — Health endpoints
`api/engine/health`, `api/market/health` are unauthenticated (normal). Confirm
they return only liveness booleans, not engine URLs, versions, or config that
aids an attacker. (Not yet line-read.)

### 🟢 Observation — auth is inconsistent in HOW it's applied
flow-ingest inlines its own cron-secret check while other crons use
`isCronAuthorized`. Functionally fine, but the duplication means a future cron
route could be added without a guard and not stand out. Recommend ALL routes go
through the shared helpers so "no helper import" is a reliable red flag.

## Files
All 42 route files enumerated and classified by guard. Routes marked ✅ had a
guard reference confirmed via grep; the SPX/market/largo cluster was spot-checked
(largo/query, nighthawk/hunt) — recommend a full line-read pass in batch 5/6 to
confirm the guard is the FIRST statement (not after side effects) in each.

## Not yet verified (queue)
- That each ✅ route calls its guard BEFORE any data fetch / mutation (ordering).
- Health endpoints' response bodies.
- SSE stream routes (`*/stream`) — confirm they close on auth failure and don't
  leak the first event before checking entitlement.
