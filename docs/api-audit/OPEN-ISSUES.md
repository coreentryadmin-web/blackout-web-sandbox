# BlackOut Open Issues Log
Last updated: 2026-06-27 08:20 ET

> 08:20 run: full re-audit from scratch — NO new issues, NO regressions. Every item below
> re-verified live this run (SPX ledger still 0/0 & veto confirmed neutered + `SPX_OPTION_CHAIN_REQUIRED`
> not set in env; anomalies/regime still 200 unauthenticated; `tsc` 0 errors; all Railway services Online;
> `UW_API_KEY` set). P2-C stays WATCH pending Monday 2026-06-29 post-RTH re-query.

> Master running list of unfixed findings from the deep-platform-audit cron (every 4h).
> P0 = user-facing breakage/data integrity · P1 = feature broken/degraded · P2 = wrong but not visible · P3 = tech debt / tooling.

## 🔴 P0 — none open

## 🟠 P1 — none active

## 🟡 P2 — open
- [ ] **P2-C ⏳ WATCH** SPX play ledger empty all-time (`spx_open_play`=0, `spx_play_outcomes`=0, verified live in prod). **Most likely EXPECTED, not a bug:** the fetch-bug fix `6f00a5e` ("query SPX chain root + don't let chain gate veto entry") merged **2026-06-26 16:20 ET, ~20 min AFTER Friday's RTH close** — so Friday ran the OLD code and NO trading session has run with the fix. Veto confirmed disabled (`spx-play-config.ts:404`); diagnostic tracing already committed (`63567cb`); cron path correctly wired (`spx-evaluator.ts:41` → `evaluateSpxPlay({mutate:true})`). **VERIFY Mon 2026-06-29 after RTH:** re-query prod `spx_open_play` (should get rows) + `spx_play_outcomes` (populates on close). IF still 0 after Monday's full session → escalate to P1 and read the `63567cb` diagnostic logs for the rejecting entry gate. Do NOT re-touch the veto. _(found 2026-06-27 07:10; corrected down from a too-strong P1 after git-timing check)_
- [ ] **P2-A** `/api/market/anomalies` (→200 `{"anomalies":[]}`) and `/api/market/regime` (→200 `{"available":false}`) serve unauthenticated, while sibling market routes 401. `middleware.ts` documents that API routes must self-authorize — these two lack a guard. No paid-data leak today (both empty) but they'd leak once they return real payloads. Add the sibling `requireToolApi`/entitlement guard or annotate as intentionally public. Files: `src/app/api/market/anomalies/route.ts`, `src/app/api/market/regime/route.ts`. _(found 2026-06-27 07:10)_
- [ ] **P2-B** `spx_signal_log` last wrote 2026-06-17 (stale 10 days). If any admin/analytics surface still reads it, it serves stale signals. Confirm superseded by the play engine; resume writes or retire table + readers. _(found 2026-06-27 07:10)_

## 🔵 P3 — open (tech debt / tooling)
- [ ] **P3-1** deep-platform-audit `SKILL.md` produces false P0/P1 every run: stale probe paths (`/api/market/spx-pulse`→`/api/market/spx/pulse`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk/edition`, `/api/grid/news`→none), wrong env-var names (`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`), and a db-handler regex (`pool\.on`) that misses the real `livePool.on("error")` (`db.ts:113`). Fix the SKILL's probe lists. _(found 2026-06-27 00:12, reconfirmed 07:10)_
- [ ] **P3-2** `spx_pulse_snapshots` and `spx_watch_setups` exist in prod with 0 rows all-time and **zero INSERT code references** in `src/` → dead/legacy tables. Drop them or wire the intended writers. _(found 2026-06-27 07:10)_

## ✅ Recently confirmed FIXED
- **P2-1 (was open 00:12)** 7 TS errors in WIP `platform/intel` + sibling routes — RESOLVED: real `tsc --noEmit` now 0 errors, files committed, `git status` clean (verified 07:10)
- **P2-2 / #97 (was open 00:12)** `SpxDarkPoolCard` — RESOLVED: now imported + mounted at `SpxDashboard.tsx:13,86` (verified 07:10)
- **#100** pg Pool idle-error handler — `db.ts:113`
- **#101** Clerk `user.created` webhook — `webhook/clerk/route.ts:77`
- **#102** Polygon WS leader election — `ws/polygon-socket.ts:117-148`
- **#73** Largo SPX grounding tools present — `largo/{spx-desk-cache,tool-defs,run-tool}.ts`
- SPX option-chain veto neutered — `spx-play-config.ts:404`
- Redis IPv6 `family: 0` — `make-redis.ts:58`
