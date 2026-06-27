# BlackOut Open Issues Log
Last updated: 2026-06-27 00:12 ET

> Master running list of unfixed findings from the deep-platform-audit cron (every 4h).
> P0 = user-facing breakage/data integrity · P1 = feature broken/degraded · P2 = wrong but not visible · P3 = tech debt / tooling.

## 🔴 P0 — none open

## 🟠 P1 — none open

## 🟡 P2 — open
- [ ] **P2-1** `src/app/api/platform/intel/route.ts:83,84,92,111,121,141,147` — 7 real TS errors (TS2769/TS2345, `.map` over `QueryResultRow[]`) in an **untracked** WIP route. `next.config` does NOT ignore TS build errors, so committing the WIP pile (`platform/`, `brief/`, `coaching/`, `track-record/`, `market/anomalies/`, `market/regime/`, `admin/run-migration/`, `lib/migrations/`) as-is breaks the Railway build. Type-correct or stash before committing. _(found 2026-06-27 00:12)_
- [ ] **P2-2 / task #97** `src/components/desk/SpxDeskPanels.tsx:104` — `SpxDarkPoolCard` exported but never imported/mounted anywhere. Mount it or delete. _(found 2026-06-27 00:12)_

## 🔵 P3 — open (audit-tooling)
- [ ] **P3-1** deep-platform-audit `SKILL.md` produces false P0/P1 every run: stale probe paths (`/api/market/spx-pulse`→`/api/market/spx/pulse`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk/edition`, `/api/grid/news`→none); db.ts handler regex `pool\.on` misses real `livePool.on("error")` (db.ts:110); `npx tsc` hits a stub (use `node node_modules/typescript/bin/tsc --noEmit`). Fix the SKILL. _(found 2026-06-27 00:12)_

## ✅ Recently confirmed FIXED (verified 2026-06-27 00:12)
- #100 pg Pool idle-error handler — `db.ts:110`
- #101 Clerk `user.created` webhook — `webhook/clerk/route.ts:77`
- #102 Polygon WS leader election — `ws/polygon-socket.ts:117-128`
- #73 Largo `computeSpxConfluence` wired — `largo/run-tool.ts:1211`
- SPX plays veto neutered — `spx-play-config.ts:404` (`playOptionChainRequired()` defaults false)
- Redis IPv6 `family: 0` — `make-redis.ts:58`
