# BlackOut Open Issues Log
Last updated: 2026-06-28 08:13 ET

> 08:13 ET run (Sunday, market closed): **P1-B FIXED IN THIS RUN.** The unauthenticated
> paid-signal leak `/api/signals/open` (200 → up to 500 `signal_events` rows incl.
> grade/ticker/strike/expiry/option_type/entry_mark/confluence_score) is now gated behind
> `isCronAuthorized` (`signals/open/route.ts:8-16`). Verified orphaned first (grep: no consumer,
> cited `signal-outcome-tracker` cron doesn't exist), so lockdown breaks nothing; `tsc`=0 after
> edit; deploys on this commit. **✅ DEPLOY VERIFIED LIVE:** post-deploy `GET /api/signals/open`
> → **401** confirmed (was 200) — P1-B closed end-to-end. **P1-A STILL OPEN
> (re-confirmed via `railway status`):** no `Market-Regime-Detector` service among the 13 live
> cron services → `market_regime`/`flow_anomalies` writers never run. `.toml`+code exist;
> needs the manual Railway "add service (Config-as-code)" step — left for operator (deploy-risky
> infra, not auto-created by audit). **P2-C** SPX play opens + **P2-D** options-socket code=1006
> loop both carry to **Mon 2026-06-29 RTH** (not sampleable market-closed). **NEW P3-META:** the
> audit skill's own PowerShell checks throw systematic FALSE POSITIVES — stale endpoint paths
> (`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `grid/news` nonexistent) and auth/handler
> regexes that miss real names (`livePool.on`, `authorizeCronOrTierApi`, `requireTierApi`,
> `webhooks/clerk` plural). SKILL.md should be corrected. Re-verified GREEN: site 200s + correct
> 401s on all tool/admin endpoints, tsc 0, db Pool error handler (`db.ts:113`)+max:5, redis
> family:0+reconnect, SPX veto neutered + `openPlay()` reached, #97/#100/#101/#102 fixed,
> blackout-web Online 5/5 + Postgres/Redis Online + all 13 crons Online/Completed.
> Full report: `docs/api-audit/deep-audit-20260628-08.md`.


> 04:08 ET run (Sunday, market closed): **1 NET-NEW P2** + both standing P1s re-confirmed open.
> **NEW P2 — options-socket shard 0 stuck in a code=1006 reconnect loop (`failures=531`).** Live
> `blackout-web` logs cycle every 60s: `connected (1 contracts)` → `reconnect in 60000ms
> (code=1006, failures=531)`. `consecutiveFailures` resets only on successful auth
> (`src/lib/ws/options-socket.ts:405-406`), so 531 = no sustained authed stream in ~8h. Closes are
> **server-initiated 1006**, not the stall watchdog (which already gates off-hours, `:453-457`).
> Benign now (market closed, `MAX_CONNECTIONS=1` slot just churning + log noise) BUT the unbounded
> counter masks a real RTH failure. **ACTION: re-check after 09:30 ET Mon** — if `failures` resets
> toward 0 once quotes flow it's cosmetic off-hours churn; if pinned, Night's Watch live valuations
> degrade → promote to P1. Suggested fix: gate `scheduleReconnect`/heartbeat on options-RTH like the
> stall watchdog already is. **P1-B STILL OPEN:** `/api/signals/open` → **200 unauthenticated**
> (`{"ok":true,"signals":[]}` now, empty/EOD-scored — but leaks paid SPX_SLAYER/NIGHT_HAWK signals
> during RTH); sibling POST routes correctly 405 on GET. Fix: add `isCronAuthorized` or delete
> (`signals/open/route.ts:8`). **P1-A STILL OPEN:** no `Market-Regime-Detector` service in
> `railway status` (`.toml` exists, never created → `market_regime`/`flow_anomalies` writers never
> run). Re-verified GREEN: site 200s + correct 401s on all tool/admin endpoints, tsc 0 (needs ≥4GB
> heap), db Pool error handler (`db.ts:113`) + pool max:5, redis family:0+reconnect, SPX veto
> neutered (`SPX_OPTION_CHAIN_REQUIRED` unset → defaults false), #97/#100/#101/#102 fixed, VAPID
> fully armed (public+private SET), all required env vars set (note: code uses `UW_API_KEY` not
> `UNUSUAL_WHALES_API_KEY`), all Railway services Online (5/5 replicas), no error logs.
> **P2-C SPX play opens: Monday 2026-06-29 RTH verification still pending.** Full report:
> `docs/api-audit/deep-audit-20260628-04.md`.


> 00:14 run (2026-06-28, Saturday night, market closed): **1 NET-NEW P1 (P1-B)** —
> `/api/signals/open` serves **200 unauthenticated** and returns up to 500 `signal_events`
> rows incl. `grade`/`ticker`/`strike`/`expiry`/`option_type`/`entry_mark`/`confluence_score`
> — i.e. the paid SPX_SLAYER + NIGHT_HAWK signal output. Currently empty live
> (`{"ok":true,"signals":[]}`, market closed/all scored to EOD) but **leaks live signals to
> anyone during RTH**. Distinct from P2-A (those are market-wide/no-paid-data); this one IS
> paid data. No in-repo consumer fetches it and the `signal-outcome-tracker` cron its comment
> cites does not exist → orphaned. Fix: add `isCronAuthorized` (sibling write routes already
> have it) or delete. `signals/open/route.ts:8`. **P3-3 gets a 3rd instance:**
> `track-record/publish/route.ts:9` uses the same fail-open `if (CRON_SECRET && …)` guard.
> Re-verified GREEN: site 200s + correct 401s, tsc 0, db Pool error handler present, redis
> family:0 + retry, SPX veto+open logic both present, #97/#100/#101/#102 confirmed fixed,
> VAPID/GEX-alerts now fully armed (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`+`VAPID_PRIVATE_KEY`+
> `VAPID_SUBJECT`+`GEX_ALERTS_PUSH` all set). Carried unchanged (not re-queryable this run —
> `railway status`/`logs` need `--service` with project token): P1-A, P2-C, P2-B.

> 20:15 run (Saturday, market closed): **P1-A REFINED — effort dropped from "build the writer" to
> "create one Railway service."** The regime/anomaly writer is now fully built in code
> (`cron/market-regime-detector/route.ts` + `cron-registry.ts:217` + `railway.market-regime-detector.toml`),
> but prod ground truth confirms it has **never run**: `market_regime`=0 rows, `flow_anomalies`=0 rows,
> `cron_job_runs[market-regime-detector]`=0 runs/7d, and **no Market-Regime-Detector service exists in
> `railway status`**. The `.toml` exists but the manual "create cron service (Config-as-code)" step was
> never done → both live consumers (FlowAnomalyBanner, NH morning-confirm) still degrade. Also: **P2-A
> now annotated-resolved** (both routes carry explicit "intentionally public" comments — the documented
> fix); concern folds into P1-A. **1 NEW P3-3:** fail-open cron-POST guard (`if (cronSecret && …)` accepts
> when CRON_SECRET unset; set in prod, so defense-in-depth only). Re-verified GREEN live: tsc 0, db/redis
> safety, veto neutered, all required env vars set, all 23 Railway services Online, no log errors. P2-C
> re-verified empty live (`spx_open_play`=0, `spx_play_outcomes`=0; spx-evaluate healthy 333 ok/63 skip/4d)
> — Monday 2026-06-29 verification still pending. P2-B `spx_signal_log` now fully empty (0 rows).

> 16:10 run (Saturday, market closed): **NO net-new issues, NO regressions.** Sharpened P2-C
> with prod ground truth — the SPX engine didn't just fail to *open*, it logged **0 BUY/APPROVE
> over the last 3 active days** (198 SCANNING · 24 WATCHING · 0 BUY in `cron_job_runs`), and two
> fresh gate fixes (`5eee3ff` 6-bug gate audit + `cee2ebf` 0DTE calibration) shipped TODAY while
> market closed → unvalidated until Monday. New positive: **VAPID keys now SET in prod → push
> alerts no longer inert.** Re-verified GREEN: tsc 0, db/redis safety, veto disabled (env-confirmed),
> all required env vars present, #97/#100/#101/#102 fixed, all Railway services Online, only benign
> weekend `skipped` cron rows (no real failures). P1-A, P2-A, P2-B, P3-1, P3-2 all carried unchanged.

> 12:13 run (Saturday, market closed): **1 NET-NEW P1 (P1-A)** — regime + flow-anomaly features
> are dead end-to-end (no writer cron exists; the "market-regime-detector cron" named in code
> doesn't exist) yet have LIVE consumers: FlowAnomalyBanner on the paid /flows page +
> nighthawk-morning-confirm via /api/platform/intel. Prior runs only caught the auth-gap angle
> (P2-A); this run traced the missing writers + live consumers. Carried items re-verified:
> tsc 0 errors, db/redis safety intact, veto neutered, #97/#100/#101/#102 fixed, all Railway
> services Online. P2-C SPX ledger stays WATCH pending Monday 2026-06-29 post-RTH re-query.

> 08:20 run: full re-audit from scratch — NO new issues, NO regressions. Every item below
> re-verified live this run (SPX ledger still 0/0 & veto confirmed neutered + `SPX_OPTION_CHAIN_REQUIRED`
> not set in env; anomalies/regime still 200 unauthenticated; `tsc` 0 errors; all Railway services Online;
> `UW_API_KEY` set). P2-C stays WATCH pending Monday 2026-06-29 post-RTH re-query.

> Master running list of unfixed findings from the deep-platform-audit cron (every 4h).
> P0 = user-facing breakage/data integrity · P1 = feature broken/degraded · P2 = wrong but not visible · P3 = tech debt / tooling.

## 🔴 P0 — none open

## 🟠 P1 — open
- [ ] **P1-A** Regime + flow-anomaly features still dead in prod — but writer is BUILT, just unwired.
  **Refined 20:15:** the writer cron now EXISTS in code (`src/app/api/cron/market-regime-detector/route.ts`
  + registry `cron-registry.ts:217` + `railway.market-regime-detector.toml`, schedule `*/5 11-21 * * 1-5`).
  But prod ground truth confirms it has **never run**: `market_regime`=**0 rows**, `flow_anomalies`=**0 rows**,
  `cron_job_runs[market-regime-detector]`=**0 runs/7d**, and **no Market-Regime-Detector service in
  `railway status`** (23 services, not one of them). The `.toml` header says "Wire it up: create a cron
  service → Config-as-code" — that manual Railway step was never done, so nothing hits the route.
  **Live consumers still degrading:** (1) `FlowAnomalyBanner` on paid `/flows` (`src/app/(site)/flows/page.tsx:41`;
  fetch `FlowAnomalyBanner.tsx:59`) → never renders; (2) `nighthawk-morning-confirm` reads via
  `/api/platform/intel` (`cron/nighthawk-morning-confirm/route.ts:110`) → defaults `currentRegime="UNKNOWN"`/0
  anomalies (`platform/intel/route.ts:72,89`). Violates "values live/correct/grounded, never blank".
  **Fix is now a single deploy action (no code):** create the Railway cron service from
  `railway.market-regime-detector.toml` via Config-as-code, set `CRON_SECRET` on it, confirm first run
  writes `market_regime`. _(found 12:13; refined 20:15 — writer confirmed built, only Railway trigger missing)_
- [ ] **P1-B (NEW 2026-06-28 00:14)** Entitlement leak — `/api/signals/open` is unauthenticated.
  `src/app/api/signals/open/route.ts:8` `GET` runs an unguarded query returning up to 500
  `signal_events` rows with `grade`, `ticker`, `strike`, `expiry`, `option_type`, `entry_mark`,
  `confluence_score` — the paid SPX_SLAYER + NIGHT_HAWK signal output. **Verified live:
  `GET https://www.blackouttrades.com/api/signals/open` → HTTP 200** (empty now — market closed,
  all scored to EOD — but exposes the day's live signals to anyone during RTH). Distinct from
  P2-A (market-wide/no-paid-data); this is paid data. **Orphaned**: no in-repo consumer fetches
  it, and the `signal-outcome-tracker` cron its comment cites does not exist anywhere in `src/`.
  **Fix:** add `isCronAuthorized` (sibling write routes `signals/record`+`signals/outcome` already
  have it) or delete the route. _(found 2026-06-28 00:14)_

## 🟡 P2 — open
- [ ] **P2-C ⏳ WATCH** SPX play ledger empty all-time (`spx_open_play`=0, `spx_play_outcomes`=0, re-verified live in prod 16:10). **Refined 16:10:** the engine never reached a BUY — `cron_job_runs` for `spx-evaluate` over the last 3 active days = **198 SCANNING · 24 WATCHING · 0 BUY/APPROVE · 42 skipped**. Cause is the confluence/Claude gates not approving, NOT the option-chain veto (confirmed disabled: `SPX_OPTION_CHAIN_REQUIRED` unset in env + `playOptionChainRequired()` defaults false at `spx-play-config.ts:417`). Two fresh gate fixes shipped **today while market closed** and are unvalidated: `5eee3ff` "unblock play entries — 6-bug gate audit" (12:35 PT) + `cee2ebf` "0DTE calibration" (12:47 PT). Cron path correct (`spx-evaluator.ts:41` → `evaluateSpxPlay({mutate:true})` → `openPlay` → `insertOpenSpxPlay`). **VERIFY Mon 2026-06-29 after RTH:** re-query `spx_open_play` (expect rows) + `cron_job_runs` for `play_action=BUY`. IF still 0 BUY after Monday's full session → escalate to P1 and read the `63567cb` diagnostic logs for the rejecting gate. Do NOT re-touch the veto. _(found 2026-06-27 07:10; refined 12:13 + 16:10)_
- [ ] **P2-A ✅ annotated-resolved** `/api/market/anomalies` and `/api/market/regime` serve 200 unauthenticated while sibling routes 401. **20:15:** both routes now carry explicit "intentionally public — market-wide, no paid data" annotations (`anomalies/route.ts:1-4`, `regime/route.ts:1-3`) — the documented-public fix prior runs proposed. No paid-data leak (both empty). Substance now folds into **P1-A** (empty because nothing writes them). Keeping pointer; auth-boundary addressed by annotation. _(found 07:10; annotation confirmed 20:15)_
- [ ] **P2-B** `spx_signal_log` is now **fully empty (0 rows, max null)** in prod — re-verified live 20:15 (prior runs saw "last wrote 06-17"; table now empty). No writer anywhere. If any admin/analytics surface reads it, it serves nothing. Confirm superseded by the play engine; retire table + readers or resume writes. _(found 07:10; re-verified empty 20:15)_

## 🔵 P3 — open (tech debt / tooling)
- [ ] **P3-1** deep-platform-audit `SKILL.md` produces false P0/P1 every run: stale probe paths (`/api/market/spx-pulse`→`/api/market/spx/pulse`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk/edition`, `/api/grid/news`→none), wrong env-var names (`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`), and a db-handler regex (`pool\.on`) that misses the real `livePool.on("error")` (`db.ts:113`). Fix the SKILL's probe lists. _(found 2026-06-27 00:12, reconfirmed 07:10)_
- [ ] **P3-2** `spx_pulse_snapshots` and `spx_watch_setups` exist in prod with 0 rows all-time and **zero INSERT code references** in `src/` → dead/legacy tables. Drop them or wire the intended writers. _(found 2026-06-27 07:10)_
- [ ] **P3-3 (NEW 20:15)** Fail-open cron-write guard. `market/anomalies/route.ts:38` and `market/regime/route.ts` POST handlers use `if (cronSecret && auth !== ` + "`Bearer ${cronSecret}`" + `)` — when `CRON_SECRET` is unset the guard short-circuits and the POST is accepted unauthenticated. `CRON_SECRET` is set in prod (no live exposure); defense-in-depth only. Prefer failing closed: `if (!cronSecret || auth !== …)`. **3rd instance found 2026-06-28 00:14:** `track-record/publish/route.ts:9` uses the identical fail-open pattern. _(found 2026-06-27 20:15; +instance 2026-06-28)_

## ✅ Recently confirmed FIXED
- **VAPID push (was inert)** — RESOLVED 16:10: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` all set in prod env → push alerts no longer inert
- **P2-1 (was open 00:12)** 7 TS errors in WIP `platform/intel` + sibling routes — RESOLVED: real `tsc --noEmit` now 0 errors, files committed, `git status` clean (verified 07:10)
- **P2-2 / #97 (was open 00:12)** `SpxDarkPoolCard` — RESOLVED: now imported + mounted at `SpxDashboard.tsx:13,86` (verified 07:10)
- **#100** pg Pool idle-error handler — `db.ts:113`
- **#101** Clerk `user.created` webhook — `webhook/clerk/route.ts:77`
- **#102** Polygon WS leader election — `ws/polygon-socket.ts:117-148`
- **#73** Largo SPX grounding tools present — `largo/{spx-desk-cache,tool-defs,run-tool}.ts`
- SPX option-chain veto neutered — `spx-play-config.ts:404`
- Redis IPv6 `family: 0` — `make-redis.ts:58`
