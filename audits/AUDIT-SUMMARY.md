# Blackout Web — Audit Summary (Step 4)

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Completed:** 2026-06-19  
> **Batches:** 7/7 — see `audits/AUDIT-PLAN.md`  
> **Detail files:** `audits/AUDIT-*.md` per batch

---

## Executive conclusion

The **highest-stakes auth holes from prior passes are fixed** (engine proxy gated, client WS key removed). Remaining risk is concentrated in **SPX play engine concurrency** (multi-path evaluator, non-transactional DB writes, cron overlap) and **operational exposure** (unguarded health telemetry, committed API key prefix in docs). Night Hawk and provider layers are largely healthy after recent fixes; open items are mostly **filter wiring** and **desk breadth caller gaps**.

**Totals (open actionable, approximate):**

| Severity | Count |
|----------|------:|
| Critical | 2 |
| High | 10 |
| Medium | 25+ |
| Low | 40+ |

---

## Critical findings

| ID | Area | File | Issue | Detail |
|----|------|------|-------|--------|
| **C1** | SPX UI | `SpxTradeAlerts.tsx` / `useSpxPlay.ts` | Stale BUY/HOLD hero after session ends | Play state cache persists when session inactive; UI shows actionable play when engine has stopped | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **C2** | SPX Desk | `spx-desk-merge.ts` | Sticky structure cache never resets | Module-level `lastGoodStructure` carries across sessions → wrong levels/structure on new day | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |

---

## High findings

| ID | Area | File | Issue | Detail |
|----|------|------|-------|--------|
| **H1** | API | `api/market/health/route.ts` | Unguarded ops telemetry | DB pool, WS health, rate limits, play-engine state exposed without auth | [`AUDIT-API-Routes.md`](./AUDIT-API-Routes.md) |
| **H2** | Frontend | `docs/api-probe/page.tsx` | Polygon API key prefix in source | Rotate key; redact committed prefix | [`AUDIT-Frontend-Config.md`](./AUDIT-Frontend-Config.md) |
| **B06-H1** | SPX Engine | `spx-play-engine.ts` + callers | Evaluator invoked from 4 uncoordinated paths | Market route, Largo tool, admin live tab, cron — race side effects | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H2** | SPX DB | `db.ts:848-886` | `insertOpenSpxPlay` non-transactional | 23505 unique violation still runs Discord/notify side effects | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H3** | Cron | `cron/spx-evaluate/route.ts` | No overlap lock | Concurrent cron + manual evaluators clobber state | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H4** | Ops | `play-engine-heartbeat.ts` | Per-process heartbeat only | Multi-instance deploy shows false uptime | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H5** | SPX Store | `spx-play-store.ts` | Session meta last-write-wins | Cooldown/re-entry gates break under parallel writes | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H6** | Admin | `AdminSpxDashboard.tsx` | Live tab auto-polls evaluator every 10s | Unintended production load + state mutation from UI | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H7** | Admin | `AdminApiEventDetail.tsx` | Telemetry URLs/bodies rendered | API keys in query strings may leak to admin UI | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |
| **B06-H8** | SPX Watch | `spx-play-watch.ts` | `consumeWatchRecord` ordering | Can skip DB persistence / double promote | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) |

---

## Fixed since prior audits (verified)

| Issue | Status |
|-------|--------|
| Unauthenticated engine proxy (`api/engine/[...path]`) | ✅ Fixed — auth + allowlist + POST 405 |
| `NEXT_PUBLIC_ENGINE_WS_KEY` in client bundle | ✅ Fixed — dead code removed |
| Night Hawk chain double-fetch | ✅ Fixed — `fetchEditionChains` |
| January expiry year rollover | ✅ Fixed — `option-chain-prompt.ts` |
| Flow ingest cursor mix (ISO/epoch) | ✅ Fixed |
| UW WS stale skip | ✅ Fixed — `isUwChannelFresh` |
| SPX signal dedup key jitter | ✅ Fixed — stable `session\|action\|direction` |
| Largo `extractTicker` false positives | ✅ Fixed |

---

## Recommended fix order (website)

1. **C1/C2** — SPX stale UI + sticky desk merge (member-facing wrong signals)
2. **B06-H1–H3** — Single evaluator entrypoint + DB transaction + cron lock
3. **H1** — Gate `market/health` or strip sensitive fields
4. **H2** — Rotate/redact Polygon key in docs
5. **B2-01** — Wire `fetchPriorDayCloses` into `buildSpxDesk` breadth
6. **M1 (Night Hawk)** — Wire swing/leap hunt filters
7. **B5-01/02 (Largo)** — Stop unconditional SPX prefetch + parallel tool storm

---

## Batch index

| Batch | File | Status |
|-------|------|--------|
| 01 Payments & Auth | [`AUDIT-Payments-Auth.md`](./AUDIT-Payments-Auth.md) | ✅ |
| 02 Market Data Providers | [`AUDIT-Market-Data-Providers.md`](./AUDIT-Market-Data-Providers.md) | ✅ |
| 03 API Routes | [`AUDIT-API-Routes.md`](./AUDIT-API-Routes.md) | ✅ |
| 04 Night Hawk | [`AUDIT-Night-Hawk.md`](./AUDIT-Night-Hawk.md) | ✅ |
| 05 Largo AI | [`AUDIT-Largo-AI.md`](./AUDIT-Largo-AI.md) | ✅ |
| 06 SPX Desk + Admin | [`AUDIT-SPX-Desk-Admin.md`](./AUDIT-SPX-Desk-Admin.md) | ✅ |
| 07 Frontend + Config | [`AUDIT-Frontend-Config.md`](./AUDIT-Frontend-Config.md) | ✅ |

---

## Completeness

All **376** tracked files assigned and audited per batch reports. No unread tracked files remain for `blackout-web`.

**Engine repo (`BlackOut-Uw-Alerts`):** separate plan at `C:\Users\raidu\BO-AAI\BlackOut-Uw-Alerts\audits\AUDIT-PLAN.md` — summary pending batch 07 (Tests/Smoke).
