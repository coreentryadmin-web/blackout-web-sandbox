# Audit — API Route Authorization (Batch 03)

> **Scope:** All 43 `src/app/api/**/route.ts` handlers (full line-read, Step 2 + Step 3).
> **Date:** 2026-06-19
> **Method:** Read every route file in full; traced auth helpers (`requireAdminApi`, `authorizeCronOrTierApi`, `authorizeMarketDeskApi`, `requireTierApi`, inline cron secret, Clerk `auth()`, Whop signature). Opened lib functions when data-flow or ownership was unclear (`market-api-auth.ts`, `admin-access.ts`, `engine.ts`, `market-health.ts`, `largo-terminal.ts`, `flow-ingest.ts`, `db.ts`).
> **Middleware:** `src/middleware.ts` does **not** protect `/api` — each route must self-authorize. Confirmed.

## Summary counts

| Metric | Count |
|--------|------:|
| Total route files | 43 |
| Guarded (auth before handler work) | 40 |
| Unguarded (no auth mechanism) | 3 |
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 2 |
| 🟢 Low / observation | 5 |

**Unguarded routes:** `api/engine/health`, `api/market/health`, `api/admin/me`

---

## Authorization matrix

| Route | Methods | Guard | First-statement auth? | Status | Notes |
|-------|---------|-------|----------------------|--------|-------|
| `api/admin/analytics/spx` | GET | `requireAdminApi` | ✅ | Guarded | — |
| `api/admin/apis/dashboard` | GET | `requireAdminApi` | ✅ | Guarded | Optional `probe=1` triggers provider probes (admin only). |
| `api/admin/apis/events/[id]` | GET | `requireAdminApi` | ✅ | Guarded | Audit-logged event view. |
| `api/admin/apis/rescan` | POST | `requireAdminApi` | ✅ | Guarded | Spawns `scripts/analyze-api-usage.mjs` (admin only). |
| `api/admin/apis/stream` | GET (SSE) | `requireAdminApi` | ✅ | Guarded | Auth before stream open; no pre-auth events. |
| `api/admin/cron-health` | GET | `requireAdminApi` | ✅ | Guarded | — |
| `api/admin/health` | GET | `requireAdminApi` | ✅ | Guarded | May fire critical alerts (`maybeAlertCriticalIssues`). |
| `api/admin/incidents` | GET, POST | `requireAdminApi` | ✅ | Guarded | POST ack/resolve audit-logged. |
| `api/admin/me` | GET | `getAdminStatus` (no deny) | N/A | **Unguarded** | Returns caller's own `{ admin, email }`; unauth → `{ admin: false, email: null }`. Intentional. |
| `api/admin/nighthawk/analytics` | GET | `requireAdminApi` | ✅ | Guarded | Window param clamped 7–180 days. |
| `api/admin/nighthawk/publish-preview` | GET | `requireAdminApi` | ✅ | Guarded | — |
| `api/admin/spx/dashboard` | GET | `requireAdminApi` | ✅ | Guarded | `live=1` audit-logged. |
| `api/cron/flow-ingest` | GET | Inline `CRON_SECRET` | ✅ | Guarded | Duplicates `isCronAuthorized` (see M1). |
| `api/cron/largo-cleanup` | GET | Inline `cronAuthorized` | ✅ | Guarded | Duplicates helper (see M1). |
| `api/cron/nighthawk-edition` | GET | Inline `cronAuthorized` | ✅ | Guarded | Can nudge edition build; cron-only. |
| `api/cron/nighthawk-outcomes` | GET | Inline `cronAuthorized` | ✅ | Guarded | — |
| `api/cron/spx-evaluate` | GET | Inline `cronAuthorized` | ✅ | Guarded | — |
| `api/engine/[...path]` | GET | `authorizeCronOrTierApi(req, "free")` | ✅ | Guarded | Allowlist: `nighthawk/plays`, `heatmap` only; POST → 405. See M2. |
| `api/engine/health` | GET | none | N/A | **Unguarded** | Liveness only; mentions `NEXT_PUBLIC_API_BASE` env name (L1). |
| `api/market/flows` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | Post-auth `maybeRunFlowIngest()` side effect (L2). |
| `api/market/flows/stream` | GET (SSE) | `authorizeMarketDeskApi` | ✅ | Guarded | Auth before `connected` event. |
| `api/market/health` | GET | none | N/A | **Unguarded** | 🟠 **HIGH** — rich ops telemetry (H1). |
| `api/market/heatmap` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/indices` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/largo/query` | POST | `requireTierApi("premium")` | ✅ | Guarded | Expensive Claude path; auth before body parse. |
| `api/market/largo/session` | GET | `requireTierApi("premium")` | ✅ | Guarded | `getLargoSessionMessages` enforces `sessionOwnedByUser` when DB present. |
| `api/market/lotto/today` | GET | `authorizeCronOrTierApi("premium")` | ⚠️ | Guarded | `requireDatabaseInProduction` runs before auth (L3); no data leak. |
| `api/market/news` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/nighthawk/edition` | GET | `authorizeCronOrTierApi("premium")` | ⚠️ | Guarded | DB check before auth (L3). Legacy engine fallback uses `BLACKOUT_INTEL_URL`. |
| `api/market/nighthawk/hunt` | POST | `authorizeCronOrTierApi("premium")` | ✅ | Guarded | Expensive agent scan; auth before body. |
| `api/market/nighthawk/play-explain` | POST | `authorizeCronOrTierApi("premium")` | ⚠️ | Guarded | DB check before auth (L3); Claude explain cached in DB. |
| `api/market/platform/snapshot` | GET | `authorizeCronOrTierApi("premium")` | ✅ | Guarded | Cross-service aggregator. |
| `api/market/spx/commentary` | POST | `requireTierApi("premium")` | ✅ | Guarded | Per-user rate limits via `checkCommentaryLimits`. |
| `api/market/spx/desk` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | `ensureDataSockets()` after auth. |
| `api/market/spx/flow` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/spx/merged` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/spx/outcomes` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/spx/play` | GET | `authorizeCronOrTierApi("premium")` | ⚠️ | Guarded | DB check before auth (L3). |
| `api/market/spx/pulse` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/market/spx/pulse/stream` | GET (SSE) | `authorizeMarketDeskApi` | ✅ | Guarded | Auth before first tick. |
| `api/market/spx/signals` | GET | `authorizeMarketDeskApi` | ✅ | Guarded | — |
| `api/membership/sync` | POST | Clerk `auth()` + own email | ✅ | Guarded | Syncs only caller's Whop tier. |
| `api/webhook/whop` | POST | Whop `webhooks.unwrap` | ✅ | Guarded | Signature verify; rejects invalid (L4 if secret unset). |

---

## Findings

### 🟠 H1 — HIGH: `api/market/health` exposes operational intelligence without auth

`GET /api/market/health` has no auth gate and returns `buildMarketHealthSnapshot()` including:

- Postgres pool stats and connection mode
- Polygon/UW websocket health
- API telemetry (recent errors, active retries, per-provider health, last calls)
- Cross-instance rate-limit alerts
- Redis pub/sub status
- **Play engine state** (`open_play`, `session_meta`, `last_signal`)

This is far beyond a liveness boolean. Any anonymous caller can map infrastructure health, provider failures, and live play-engine posture. **Recommend:** gate with `requireAdminApi` or strip to `{ ok, as_of }` for public probes.

### 🟡 M1 — MEDIUM: Cron auth duplicated inline (5 routes)

`flow-ingest`, `largo-cleanup`, `nighthawk-edition`, `nighthawk-outcomes`, `spx-evaluate` each re-implement the same `CRON_SECRET` check instead of `isCronAuthorized` from `market-api-auth.ts`. Functionally correct today; duplication increases risk a future cron route omits the check.

### 🟡 M2 — MEDIUM: Engine proxy allows any signed-in user (`free` tier)

`api/engine/[...path]` uses `authorizeCronOrTierApi(req, "free")` — any Clerk session (including free tier) can proxy allowlisted paths via server credentialed `fetchEngine` (`DASHBOARD_API_SECRET`). Mitigations present: path allowlist (`nighthawk/plays`, `heatmap`), POST disabled, traversal blocked. **Not critical** (requires account), but broader than premium-only market routes. Confirm product intent.

### 🟢 L1 — LOW: `api/engine/health` hints at config

Returns `{ ok, engine, message: "Set NEXT_PUBLIC_API_BASE on Railway" }` when unconfigured. No secrets, minor recon aid.

### 🟢 L2 — LOW: `api/market/flows` lazy-ingest side effect

Authenticated premium/cron callers trigger `maybeRunFlowIngest()` (UW poll). Gated behind `authorizeMarketDeskApi`; acceptable but couples read path to write-ish ingest.

### 🟢 L3 — LOW: Auth ordering — DB check before auth (4 routes)

`lotto/today`, `nighthawk/edition`, `nighthawk/play-explain`, `spx/play` call `requireDatabaseInProduction()` before `authorizeCronOrTierApi`. In prod without DB, returns 503 before 401 — minor information leak (DB requirement visible). No sensitive data fetched pre-auth.

### 🟢 L4 — LOW: Whop webhook secret unset

`WHOP_WEBHOOK_SECRET ?? null` passed to SDK; invalid signatures return 400. If secret never set, all webhooks fail closed (membership won't sync). See Payments-Auth batch for full treatment.

### ✅ Resolved vs `complete-repo-bugs/AUDIT-API-Routes.md`

| Item | Prior draft | Current code (full read) |
|------|-------------|--------------------------|
| `api/engine/[...path]` | 🔴 CRITICAL — **NONE** (open credentialed proxy) | **Guarded** — `authorizeCronOrTierApi("free")` + allowlist + POST 405 |
| Route count | 42 enumerated | **43** (+ `api/market/health`) |
| Health endpoints | "verify response bodies" (not line-read) | Line-read: `engine/health` benign; `market/health` **HIGH** |
| SSE streams | "confirm auth before first event" | **Confirmed** on all 3 SSE routes |
| Guard-before-side-effects | Queued | **Confirmed** on all guarded routes except L3 ordering |

---

## Second Pass (Step 3 — edge cases)

### SSE / streaming routes

| Route | Auth before stream? | Pre-auth data leak? |
|-------|--------------------|--------------------|
| `admin/apis/stream` | ✅ `requireAdminApi` first | None |
| `market/flows/stream` | ✅ `authorizeMarketDeskApi` first | First event is `connected` (post-auth) |
| `market/spx/pulse/stream` | ✅ `authorizeMarketDeskApi` first | First tick post-auth |
| `market/largo/query` (stream mode) | ✅ `requireTierApi` before `ReadableStream` | None |

### Engine proxy hardening

- Path normalization rejects `..` and non-allowlisted segments → 404.
- Query string forwarded to engine (allowlisted paths only).
- `fetchEngine` appends `DASHBOARD_API_SECRET` server-side; never returned to client.
- Dedicated `/api/engine/health` excluded from catch-all.

### Tier semantics (`tiers.ts`)

- `parseTier`: `premium` / `pro` / `elite` → premium; else free.
- `authorizeCronOrTierApi(req, "free")` = cron secret **OR** any signed-in user.
- Market desk routes require **premium** (or cron).

### Largo session isolation

`getLargoSessionMessages(sessionId, userId)` calls `sessionOwnedByUser` when DB configured; returns empty messages if not owner. Dev without DB: ownership check skipped (`sessionOwnedByUser` returns `true` when `!dbConfigured()`) — dev-only.

### Cron window gating

Cron routes enforce time windows (`nighthawk-edition`, `nighthawk-outcomes`, `spx-evaluate`) with `?force=1` override — all still require cron secret first.

### `admin/me` threat model

Unguarded but self-scoped: reveals whether **authenticated** caller is admin. Unauthenticated always `{ admin: false }`. Acceptable for admin UI bootstrap.

---

## Recommendations (priority)

1. **H1:** Add `requireAdminApi` to `api/market/health` OR return minimal public snapshot.
2. **M1:** Refactor cron routes to `isCronAuthorized(req)` from `market-api-auth.ts`.
3. **M2:** Document or tighten engine proxy to `premium` if free-tier access is unintended.
4. **L3:** Swap order: auth check before `requireDatabaseInProduction` on 4 market routes.

---

## Files audited (43/43)

All paths listed in `audits/AUDIT-PLAN.md` Batch 03 — full line-read complete.
