# 05 · Cron Jobs & Background Processes — Full Audit (Deliverable G)

**Scope:** every cron / scheduled / polling / worker / background process in `blackout-web`.
**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Lens:** launch scaling from <10 users today to ~500 CONCURRENT users.
**Method:** read-only enumeration via Grep/Glob/Read. Runtime/prod facts I could not confirm from code are marked **"Not verified — needs X."**

---

## 1. How scheduling actually works here

There is **no in-app scheduler** (no `node-cron`, no `setInterval`-driven cron loop). All scheduled work is fired **externally by Railway cron services**:

- Each cron is a **separate Railway service** with its own `railway.<name>.toml`. Each runs `node scripts/hit-cron.mjs /api/cron/<name>` on a `cronSchedule`, then exits (`restartPolicyType = "never"`, `numReplicas = 1`).
- `scripts/hit-cron.mjs` is a thin Node-stdlib client: it `fetch`es `https://blackouttrades.com/api/cron/<name>` (override `CRON_TARGET_BASE_URL`) with `Authorization: Bearer ${CRON_SECRET}`, prints the first 2000 chars of the body, and `process.exit(1)` on non-2xx.
- The **HTTP route runs inside the main Next.js web service** (`railway.toml`: `next start`). So all real work — UW/Polygon calls, Postgres writes, Redis warms — executes **on the web app process, not on the cron service**. The cron service is just a timer + curl. This is important: cron load lands on the **same process serving 500 users**.
- Authority for "what crons exist" is split across **three** places that must stay in sync: `src/lib/cron-registry.ts` (monitoring/registry), the `railway.*.toml` files (actual schedule), and `src/app/api/cron/**` (the code). They are **already out of sync** (see Finding C1).

### Inventory

| Key | Route | Railway TOML | cronSchedule (UTC) | Registry? | Upstream fan-out | Auth |
|---|---|---|---|---|---|---|
| flow-ingest | `/api/cron/flow-ingest` | yes | `*/2 11-21 * * 1-5` | yes | UW flow alerts (1 call, WS-gated) | CRON_SECRET |
| spx-evaluate | `/api/cron/spx-evaluate` | yes | `*/5 11-21 * * 1-5` | yes | cache-reader (desk cache lanes) | CRON_SECRET |
| uw-cache-refresh | `/api/cron/uw-cache-refresh` | yes | `*/2 11-21 * * 1-5` | yes | **~21 UW + 1 Polygon calls/run** | CRON_SECRET |
| nights-watch-warm | `/api/cron/nights-watch-warm` | yes | `* 11-21 * * 1-5` (**every min**) | yes | Polygon chains + GEX, ≤300 chains | CRON_SECRET |
| nighthawk-edition | `/api/cron/nighthawk-edition` | yes | `*/15 21-23 * * 1-5` | yes (`nighthawk-playbook`) | Claude + dossier pipeline | CRON_SECRET |
| nighthawk-outcomes | `/api/cron/nighthawk-outcomes` | yes | `30 20,21 * * 1-5` | yes | Polygon next-day prices | CRON_SECRET |
| membership-reconcile | `/api/cron/membership-reconcile` | yes | `0 * * * *` (**hourly**) | yes (label says "every 6h") | Whop + Clerk full-base paginate | CRON_SECRET |
| db-cleanup | `/api/cron/db-cleanup` | yes | `0 7 * * *` | yes | Postgres batched deletes | CRON_SECRET |
| largo-cleanup | `/api/cron/largo-cleanup` | yes | `0 8 * * 0` | yes | Postgres delete | CRON_SECRET |
| cron-staleness-watchdog | `/api/cron/cron-staleness-watchdog` | yes | `*/20 * * * *` | yes | Postgres read + Discord | CRON_SECRET |
| **gex-alerts** | `/api/cron/gex-alerts` | **NONE** | **never fires** | **NO** | cache-reader GEX + web-push | CRON_SECRET |
| **gex-eod-snapshot** | `/api/cron/gex-eod-snapshot` | **NONE** | **never fires** | **NO** | cache-reader GEX, 11 tickers | CRON_SECRET |

### Long-running background processes (not Railway crons, but in scope)

- **UW multiplex WebSocket** (`src/lib/ws/uw-socket.ts`) — single socket, 30 s heartbeat `setInterval`, exponential-backoff reconnect (cap 30 s), half-open stall watchdog.
- **Polygon socket** + **options socket** (`src/lib/ws/polygon-socket.ts`, `options-socket.ts`) — env-gated.
- **Flow event bridge** (`initFlowEventBridge`) — Redis pub/sub subscriber.
- All booted **lazily per web process** by `ensureDataSockets()` (`src/lib/ws/init-data-sockets.ts`), called from `src/app/api/market/*` route handlers and `spx-desk.ts`. **Not** booted in `instrumentation.ts` (edge-bundle reason documented there).

---

## 2. The 500-concurrent-user thesis (read this first)

Three structural facts combine into the single biggest risk:

1. **Cron work runs on the web process**, not the cron service.
2. The **rate limiters are per-process token buckets** with only an *optional* Redis-global ceiling (`uw-rate-limiter.ts`, `polygon-rate-limiter.ts`). The local bucket (`MAX_RPS`, `MAX_CONCURRENCY`) is per-replica; only `acquireGlobalRedisSlot()` is cluster-wide, and it **fails OPEN** when Redis is unavailable.
3. The **main web `railway.toml` has no `numReplicas`** (defaults to 1). At 500 concurrent users the obvious scaling move is to add web replicas — but the moment there is >1 web replica, **(a)** every replica opens its own UW/Polygon WebSocket (N sockets, possible `code=1008` collision), and **(b)** the local rate-limiter buckets multiply: 2 replicas = 2× local UW RPS unless `REDIS_URL` is set AND Redis stays up. The UW 2 rps cluster ceiling is then enforced **only** by Redis, with no fallback. This is the amplification ceiling that crons feed into.

The cron amplifiers against this ceiling are **uw-cache-refresh** (~21 UW calls every 2 min) and **flow-ingest** (every 2 min). They are designed correctly as cache-warmers, but they share the same 2 rps budget as the live desk serving 500 users.

---

## 3. Findings

### Finding C1 — Two GEX crons (`gex-alerts`, `gex-eod-snapshot`) have NO schedule and NO monitoring — silently dead

- **Severity:** High
- **File:** `src/app/api/cron/gex-alerts/route.ts`, `src/app/api/cron/gex-eod-snapshot/route.ts`; absence in `src/lib/cron-registry.ts` and `railway.*.toml`.
- **Code reference:**
  - `gex-alerts/route.ts:19-24` — the route's own header comment admits it: *"Registering that schedule is infra-owned and intentionally NOT done here … needs a per-service `railway.gex-alerts.toml`."* No such file exists (`ls railway.*.toml` returns 11 files, none for gex).
  - `cron-registry.ts:16-114` — `CRON_JOBS` array contains 11 entries; neither `gex-alerts` nor `gex-eod-snapshot` is among them.
  - Grep confirmation: `grep -rln "gex-alerts\|gex-eod" src/lib/cron-registry.ts railway*.toml` → `NONE`.
- **Why it's a problem:** These routes exist and authenticate, but nothing ever calls them. `gex-eod-snapshot` is the writer for the day-over-day "vs prior close" history the heatmap relies on; without it the `history_context` block never populates and `gex-alerts` (when activated) can never fire a regime cross because there is no prior-day snapshot to diff against. Worse, the **watchdog cannot see them**: `cron-staleness-watchdog` only iterates `CRON_JOBS` (`admin-cron-health.ts:166`), so a job not in the registry is invisible — there is no "stale" alert because there is no expectation of a run.
- **Impact (500 users):** The flagship Heat Maps product ships a broken day-over-day feature to every paid user, with zero alerting that it's broken. If `GEX_ALERTS_PUSH` is ever turned on expecting push alerts, none arrive and ops won't know.
- **Recommended fix:** Add `railway.gex-eod-snapshot.toml` (fire ~`10 20,21 * * 1-5` UTC = ~4:10 PM ET dual-band like the others) and `railway.gex-alerts.toml` (`*/5 11-21 * * 1-5`), and add both to `CRON_JOBS` so the watchdog covers them.
- **Example:**
```toml
# railway.gex-eod-snapshot.toml
[deploy]
startCommand = "node scripts/hit-cron.mjs /api/cron/gex-eod-snapshot"
cronSchedule = "10 20,21 * * 1-5"
restartPolicyType = "never"
numReplicas = 1
```
```ts
// add to CRON_JOBS in cron-registry.ts
{ key: "gex-eod-snapshot", name: "GEX EOD Snapshot", kind: "http",
  path: "/api/cron/gex-eod-snapshot", schedule_label: "~4:10 PM ET weekdays",
  stale_after_min: 36 * 60, weekdays_only: true,
  description: "Persist EOD GEX close levels for day-over-day heatmap context" },
```

---

### Finding C2 — `membership-reconcile` schedule (hourly) contradicts its own registry label (6h) and paginates the entire Clerk user base + full Whop membership list every run

- **Severity:** High
- **File:** `railway.membership-reconcile.toml`, `src/lib/cron-registry.ts:96-104`, `src/lib/membership.ts:146-220`
- **Code reference:**
  - `railway.membership-reconcile.toml`: `cronSchedule = "0 * * * *"` (every hour).
  - `cron-registry.ts:101` says `schedule_label: "Every 6h"` and `stale_after_min: 13 * 60` (780 min). The watchdog therefore won't flag staleness until 13h — far looser than either 1h or 6h, so a stuck reconcile hides for half a day.
  - `membership.ts:177-191` — full Clerk pagination loop `getUserList({ limit: 100, offset })` over the *entire* user base; `:168` — full Whop `memberships.list` iteration; `:202-211` — then **one `syncWhopMembershipForEmail` per email serially**, each of which itself does multiple Whop list calls (`:52`, `:87`) + a Clerk update per matched user.
- **Why it's a problem:** (1) Doc/label/schedule three-way mismatch means ops reasons about the wrong cadence and the watchdog threshold is wrong. (2) The reconcile cost is **O(active subscribers + premium users) Whop+Clerk API calls, serially, every hour**. At 500 users that is hundreds of Whop API calls in a tight serial loop on the web process. Whop rate limits are **Not verified — needs Whop plan limits**, but a serial full-base sweep every hour is the classic "fine at 10 users, throttled/timed-out at 500" trap. `maxDuration = 300` (route) caps it at 5 min; if the sweep exceeds that the function is killed mid-loop and tiers are left **partially reconciled** with no resume cursor.
- **Impact (500 users):** Hourly Whop/Clerk API pressure; a slow sweep that overruns 300 s silently truncates (lockouts/revenue-leaks persist); the loose 13h stale threshold means a hard-failing reconcile won't page ops until the next morning.
- **Recommended fix:** Decide the real cadence (hourly is fine if it completes) and make label + `stale_after_min` match (`stale_after_min ≈ 150` for hourly). Bound the work: process emails with a small concurrency pool instead of fully serial, and persist a cursor so a 300 s timeout resumes rather than restarts. Alert if `errors > 0` (today `errors` is logged but never alerts — see C8).

---

### Finding C3 — Rate-limiter local buckets are per-process; web app has `numReplicas` unset, so horizontal scaling to serve 500 users multiplies the UW/Polygon RPS unless Redis is up

- **Severity:** Critical
- **File:** `railway.toml`, `src/lib/providers/uw-rate-limiter.ts:12-15,168-195,227-240`, `src/lib/providers/polygon-rate-limiter.ts:31-35,172-196`
- **Code reference:**
  - `railway.toml` has no `numReplicas` line (defaults to 1 today).
  - `uw-rate-limiter.ts:22` `let tokens = MAX_RPS;` — **module-scope, per-process** bucket. `:230` only consults Redis `if (process.env.REDIS_URL?.trim())`; `acquireGlobalRedisSlot()` `:169` `if (!client) return true;` — **fails OPEN**.
  - Same shape in `polygon-rate-limiter.ts:174` `if (!client) return true; // FAIL-OPEN`.
- **Why it's a problem:** The UW "2 rps cluster-wide" rule is only truly cluster-wide when `REDIS_URL` is set and Redis is reachable. The local token bucket (`MAX_RPS=2` per process) means **2 web replicas = up to 4 rps to UW** the instant Redis hiccups (30 s backoff window in `getSharedRedis`, `:102`), during which the limiter degrades to local-only on *every* replica simultaneously. Adding replicas is the natural response to 500 concurrent users, and it directly breaks the one hard external limit.
- **Impact (500 users):** Scaling out the web tier (the thing you do to serve 500 users) silently doubles/triples UW call rate, tripping UW's account-level 429s → the circuit breaker opens cluster-wide → the **live SPX desk + flow feed degrade for all users at once**. The cron amplifiers (uw-cache-refresh) make the burst worse.
- **Recommended fix:** Treat `REDIS_URL` as **required** for multi-replica (fail-closed or alert if unset while `numReplicas > 1`). Set `UW_MAX_RPS` per-replica to `2 / numReplicas` so even the fail-open local path stays under budget. Pin web `numReplicas` explicitly in `railway.toml` and document that raising it requires lowering per-replica `UW_MAX_RPS`. Consider moving cron-driven UW fan-out (uw-cache-refresh) to a **dedicated single worker service** so user-facing replicas never spend the UW budget on warming.

---

### Finding C4 — `nights-watch-warm` fires every single minute, walks every user's open positions, and fans out Polygon chain + GEX calls with only a soft per-run cap

- **Severity:** High
- **File:** `railway.nights-watch-warm.toml`, `src/app/api/cron/nights-watch-warm/route.ts:26,71-99`
- **Code reference:**
  - `railway.nights-watch-warm.toml`: `cronSchedule = "* 11-21 * * 1-5"` — the leading `*` is **every minute** (~390 fires/trading day).
  - `route.ts:26` `const MAX_CHAINS = … process.env.NIGHTS_WATCH_WARM_MAX ?? "300"` — up to **300 distinct (ticker,expiry) chains per run**.
  - `route.ts:77-79` warms all chains via `Promise.allSettled(... getNwChain ...)` — concurrent, then `:99` a second `Promise.allSettled` over distinct non-SPX tickers for GEX.
- **Why it's a problem:** This is the per-user feature warmer, and it scales with **user count × distinct chains**. At 10 users with a handful of positions it's trivial. At 500 users each holding several positions, the distinct (ticker,expiry) set can approach the 300 cap, and the route fires that warm **every 60 seconds**. Each cold chain is a Polygon fetch; 300 concurrent `getNwChain` calls lean on the *permissive* Polygon limiter (`MAX_CONCURRENCY=24`, `MAX_RPS=40`) — so a cold cache (e.g. right after a deploy mid-session) means ~300 fetches draining the Polygon bucket the live GEX/desk path also uses. `maxDuration=120`; if a warm run exceeds 120 s it's killed and the next-minute fire starts cold again — a thrash loop.
- **Impact (500 users):** Sustained Polygon REST pressure every minute during RTH; on a cold cache the warm burst competes with the live desk for the Polygon bucket and can trip the 5-consecutive-429 breaker (`polygon-rate-limiter.ts:39`), briefly degrading GEX/desk for everyone. The `MAX_CHAINS=300` cap silently drops chains beyond 300 (`route.ts:120` `capped`), so the 301st+ user position is **not** a cache hit and pays a per-user upstream fetch — exactly the anti-pattern the cron exists to prevent.
- **Recommended fix:** (1) Raise the cap with user growth OR shard the warm across multiple minutes (warm half the chains on even minutes, half on odd) so a single fire never bursts 300 cold fetches. (2) Add a dedicated Polygon "warm lane" with lower concurrency than the live lane (the signature `acquirePolygonSlot(_lane?: "default" | "nights-watch")` already anticipates this but the lane param is ignored — wire it). (3) Alert when `capped === true` (means you've outgrown 300 and users are silently falling back to per-user fetches).

---

### Finding C5 — All cron failure alerting funnels through a single Discord webhook with no secondary channel; if the webhook is misconfigured, every silent-failure guarantee is void

- **Severity:** High
- **File:** `src/lib/cron-run.ts:35-41`, `src/app/api/cron/cron-staleness-watchdog/route.ts:38-43`, `src/lib/spx-play-notify.ts:38-58`
- **Code reference:**
  - `cron-run.ts:35` `if (status === "failed") { void notifyOpsDiscord({...}).catch(() => undefined); }` — fire-and-forget, error swallowed.
  - `spx-play-notify.ts:44-50` — if `DISCORD_OPS_WEBHOOK_URL` is unset it **falls back to the play webhook** (pollutes the trade channel) and if neither is set it `return`s silently (`:50`).
  - `cron-staleness-watchdog/route.ts:42` `.catch(() => undefined)` — the watchdog's own alert is also best-effort.
- **Why it's a problem:** The entire observability story ("watchdog catches silently-dead crons", "failed runs page ops") terminates at **one Discord webhook**. If `DISCORD_OPS_WEBHOOK_URL` is wrong/rotated/rate-limited, alerts vanish with no fallback and no error surfaced (every call is `.catch(() => undefined)`). There is no PagerDuty/email/SMS path. Discord webhooks are themselves rate-limited (**Not verified — needs Discord webhook limits**); a burst of cron failures could get the alerts throttled exactly when you most need them.
- **Impact (500 users):** A revenue-affecting silent failure (membership-reconcile dead → paying users locked out; flow-ingest dead → empty flow feed) goes completely unnoticed if the single webhook is down. The watchdog cannot save you because the watchdog uses the same sink.
- **Recommended fix:** Add a second, independent alert channel (email via Resend/SES or PagerDuty) for `severity: "critical"`. Surface webhook-post failures to the error sink (`captureError`) instead of swallowing. Add a synthetic "heartbeat" alert (e.g. watchdog posts an "all healthy" ping once/day) so a *silent* webhook is itself detectable.

---

### Finding C6 — `uw-cache-refresh` fans out ~21 UW calls + 1 Polygon call every 2 minutes, sharing the 2 rps budget with the live desk; partial failures never alert

- **Severity:** Medium
- **File:** `src/app/api/cron/uw-cache-refresh/route.ts:23-127`
- **Code reference:**
  - `route.ts:42-100` builds the task list: 1 market tide + 5 sector tides + 1 dark-pool-recent + 1 Polygon movers + 1 top-net-impact + 1 congress + (4 index tickers × 3 = 12) + (2 flow-per-strike) = **~22 tasks, ~21 of them UW**.
  - `route.ts:102` `Promise.allSettled(tasks.map((fn) => fn()))` — all fired together, paced only by the shared UW limiter (2 rps).
  - `route.ts:117-124` `ok: !allFailed` — logs `ok` (no alert) unless the **whole** batch fails; partial failures only `console.warn` (`:110`).
- **Why it's a problem:** 21 UW calls at 2 rps = ~10.5 s minimum just to drain this one cron's queue, every 2 minutes, **competing with the live desk/flow feed of 500 users for the same 2 rps bucket**. The design intent (warm cache so users read Redis) is correct, but during the warm window live UW reads are starved/queued behind the warm batch. And because only a *total* failure alerts, a UW endpoint that's been failing for hours (e.g. congress endpoint deprecated) shows green while serving stale/empty cache to users.
- **Impact (500 users):** Every 2 min there is a ~10 s window where the UW limiter is saturated by warming, adding latency to live desk reads. A chronically-failing single endpoint silently serves stale data to all users with no alert.
- **Recommended fix:** Move this cron's UW fan-out to a **dedicated worker service / dedicated UW lane** with a reserved sub-budget so it can't starve live reads (mirrors the C3 recommendation). Add a partial-failure alert: if the *same* task key fails N consecutive runs, alert (distinct from "whole batch failed"). Consider widening the schedule to `*/3` if cache TTLs (`marketTide: 180s`) allow — the 2-min cadence is tighter than the 3-min TTL needs.

---

### Finding C7 — `flow-ingest` advisory lock is `pg_try_advisory_lock` (cross-replica), but in-process `ingestInFlight` coalescer is bypassed by the cron route; correct today, fragile under scale-out

- **Severity:** Medium
- **File:** `src/app/api/cron/flow-ingest/route.ts:13-16`, `src/lib/providers/flow-ingest.ts:13,55-58,123-140`
- **Code reference:**
  - `flow-ingest/route.ts:13` checks module-scope `ingestInFlight` (in-process coalescer) — but this is **per web replica**, so it only dedups against same-process lazy ingests.
  - `flow-ingest.ts:55` `const acquired = await tryAdvisoryLock(FLOW_INGEST_LOCK);` is the real cross-replica gate, and the comment at `:48-54` correctly notes the cron calls `runFlowIngest()` directly, bypassing the coalescer.
  - `flow-ingest.ts:35-42` — REST ingest self-skips when the UW **WebSocket** is OPEN and fresh (`ws_active`). So the cron is a *fallback* poller behind the WS.
- **Why it's a problem:** This is actually one of the better-built crons (advisory lock + `alert_id UNIQUE` dedup). The risk is structural: the cron fires every 2 min on a **single** cron service (`numReplicas=1`), but the *work* runs on whichever web replica answers the HTTP call. With >1 web replica, two near-simultaneous fires (or a cron fire racing a lazy desk-driven ingest on another replica) are gated only by the Postgres advisory lock — which is correct, but means a held lock returns `skipped: "locked"` and **that ingest cycle is simply dropped**, not retried. At 2-min cadence a dropped cycle = up to 2 min of flow-alert latency.
- **Impact (500 users):** If the UW WS is flapping (so REST fallback is active) and replicas contend on the advisory lock, flow alerts can lag ~2 min behind. Not data-loss (UNIQUE + cursor recover next cycle), but latency the flow feed users will notice.
- **Recommended fix:** On `skipped: "locked"`, have the loser briefly retry (short backoff) rather than drop the cycle, OR shorten the cron cadence so a dropped cycle costs less. Confirm the WS-fresh gate (`isUwChannelFresh("flow_alerts", 120_000)`) is evaluated on the *same* replica that holds the live WS — across replicas, a replica without the WS will think WS is down and do REST while another has the WS live (**Not verified — needs runtime replica/WS topology**).

---

### Finding C8 — Several crons log `errors`/`skipped` counts but only alert on total failure; chronic partial failure is invisible

- **Severity:** Medium
- **File:** `src/app/api/cron/nighthawk-outcomes/route.ts:47-52`, `uw-cache-refresh/route.ts:117-124`, `nights-watch-warm/route.ts:111-122`, `membership-reconcile/route.ts:24-25`, `src/lib/cron-run.ts:18,35`
- **Code reference:**
  - `cron-run.ts:18` status is `failed` only when `result.ok === false`; alert fires only on `failed` (`:35`).
  - `nighthawk-outcomes/route.ts:47-52` logs `errors: result.errors` but always with `ok: true` — a run where every outcome errored still logs green.
  - `uw-cache-refresh/route.ts:119` `ok: !allFailed` — same pattern.
  - `nights-watch-warm/route.ts:111` `allFailed = capped.length > 0 && failed === capped.length` — same.
  - `membership-reconcile/route.ts:25` `{ ok: true, ...result }` — `errors` count is logged but `ok` is always true.
- **Why it's a problem:** The system deliberately suppresses alerts on partial failure ("one flaky UW task shouldn't page ops every 2 min" — a reasonable instinct). But there is **no rate-of-failure tracking**: a task that fails on *every* run (not all tasks, just one) is permanently green. The `meta_json` carries the counts but nothing reads them to alert. So "5 of 22 UW refreshes have failed every run for 3 days" produces zero pages.
- **Impact (500 users):** Slow-burn degradation (one upstream endpoint dead, a subset of outcomes never resolving, a subset of memberships erroring) accumulates unseen. Users get stale/missing data on specific signals with full green dashboards.
- **Recommended fix:** Extend the watchdog (which already reads `meta_json`, `admin-cron-health.ts:144`) to alert when a job's `runs_24h.failed` ratio or a per-task error count crosses a threshold across consecutive runs. Add a `partial_degraded` health status distinct from `failed`.

---

### Finding C9 — Crons run unbounded/un-timed except where a route sets `maxDuration`; the cron *service* has no timeout, so a hung HTTP call can wedge a run

- **Severity:** Medium
- **File:** `scripts/hit-cron.mjs:27-38`, route `maxDuration` declarations
- **Code reference:**
  - `hit-cron.mjs:28` `await fetch(url, { method: "GET", headers: {...} })` — **no `signal`/`AbortController`, no timeout**. If the web app hangs (overloaded at 500 users), the cron `fetch` hangs indefinitely.
  - Route `maxDuration` is inconsistent: `nighthawk-edition` 300, `membership-reconcile` 300, `nights-watch-warm`/`gex-*`/`nighthawk-outcomes` 120, but `flow-ingest`, `spx-evaluate`, `db-cleanup`, `largo-cleanup`, `uw-cache-refresh`, `membership` route file — several have **no `maxDuration`** (defaults apply; **Not verified — needs Next/Railway default**).
  - `db-cleanup/route.ts` has no `maxDuration`; the batched delete loop (`CLEANUP_MAX_BATCHES = 10_000` × 5000 rows) could in principle run very long on a huge backlog.
- **Why it's a problem:** With `restartPolicyType = "never"`, a hung `fetch` means the cron service process just sits open until Railway's own cron-run ceiling (if any) kills it; meanwhile the *next* scheduled fire may overlap. No client-side timeout means a degraded web app (likely at 500 users) turns every cron into a hanging connection consuming a server worker.
- **Impact (500 users):** Under load the web app is slow → cron fetches hang → cron-held HTTP connections pile up on the already-loaded web app → feedback loop. A hung flow-ingest fetch also means no `logCronRun`, so the run appears "never happened" and eventually trips the watchdog *correctly* but only after the stale window.
- **Recommended fix:** Add an `AbortController` timeout to `hit-cron.mjs` (e.g. 90 s, less than the next fire interval for the 2-min crons). Set an explicit `maxDuration` on every cron route. Bound `db-cleanup` with a wall-clock budget, not just batch count.

---

### Finding C10 — `spx-evaluate` runs every 5 min but the engine relies on `spx-broadcaster`/heartbeat that the cron does not itself drive; cron-vs-heartbeat staleness logic is dual-sourced and easy to misread

- **Severity:** Low
- **File:** `src/app/api/cron/spx-evaluate/route.ts`, `src/lib/admin-cron-health.ts:169-187`
- **Code reference:**
  - `spx-evaluate/route.ts:38-83` reads from **cached** desk lanes (`loadMergedSpxDesk` → `withServerCache`), so the 5-min tick is a cache-reader (good).
  - `admin-cron-health.ts:169` special-cases `spx-evaluate` to blend `loadPlayEngineHeartbeat()` with the cron-log age — if the cron is stale but the engine heartbeat is fresh it downgrades `stale` → `warning`/`healthy`.
- **Why it's a problem:** The engine's "liveness" is split across (a) the Railway cron firing the HTTP route every 5 min and (b) an independent heartbeat written elsewhere. The health snapshot reconciles them, but operationally this means "is the SPX engine alive?" has two sources of truth. If the heartbeat is written by a path that *isn't* this cron (e.g. live desk requests), then at low traffic (overnight, pre-launch) the engine could appear healthy purely because the cron fires, or appear stale because no users are driving the heartbeat — masking real issues.
- **Impact (500 users):** Mostly an observability clarity issue. At 500 users heartbeat is continuously driven so this is benign; the risk is during low-traffic windows where the blended status can mislead ops.
- **Recommended fix:** Document which path writes the play-engine heartbeat and ensure the 5-min cron itself bumps it, so cron-liveness and engine-liveness are the same fact. Otherwise keep the blend but label the status source explicitly (the meta already carries `play_engine_heartbeat`).

---

### Finding C11 — Every web replica boots its own UW/Polygon WebSocket; multi-replica scale-out risks N sockets and `code=1008` reconnect collisions

- **Severity:** Medium
- **File:** `src/lib/ws/init-data-sockets.ts:44-66`, `src/lib/ws/uw-socket.ts:295-309,562-691`
- **Code reference:**
  - `init-data-sockets.ts:44` `ensureDataSockets()` — `if (initialized) return;` is **per process**, so each replica initializes its own sockets.
  - `uw-socket.ts:296` treats `event.code === 1008` as an auth failure; the shutdown comment in `init-data-sockets.ts:71-74` explicitly mentions *"the code=1008 indices reconnect collision when the new container's connection lands"* — i.e. the codebase already knows multiple connections collide.
  - `uw-socket.ts:682` 30 s heartbeat `setInterval` per process; reconnect loop with backoff `:307`.
- **Why it's a problem:** UW (and likely the Polygon indices socket) appears to allow a limited number of concurrent connections per account. Today with 1 web replica this is fine. The instant you scale web to 2+ replicas to handle 500 users, each opens a multiplex socket → connection-limit collisions (`1008`) → reconnect storms with exponential backoff across replicas, and the flow WS may flap, forcing the REST `flow-ingest` fallback (which then pressures the 2 rps budget — see C6/C7).
- **Impact (500 users):** Scaling the web tier (again, the natural 500-user move) destabilizes the live data sockets. Symptoms: intermittent flow feed gaps, GEX/tide store going stale, REST fallback amplifying UW load.
- **Recommended fix:** Run the data sockets in a **single dedicated socket/worker service** (not on every web replica) and have web replicas read the resulting stores from Redis, OR add a Redis leader-election lock so only one replica holds the live sockets. Treat `code=1008` reconnect collisions as a first-class scaling blocker before raising web `numReplicas`.

---

### Finding C12 — `db-cleanup` retention windows and outcome-table guards are correct, but the run is unsupervised for lock duration; a large backlog can hold locks on hot tables

- **Severity:** Low
- **File:** `src/app/api/cron/db-cleanup/route.ts:46-76,87-129`
- **Code reference:**
  - `db-cleanup/route.ts:46` `CLEANUP_BATCH_SIZE = 5000`, `:47` `CLEANUP_MAX_BATCHES = 10_000` — the batched `DELETE … WHERE ctid IN (SELECT … LIMIT 5000)` is the right pattern (short locks, yields between batches).
  - `:97` `Promise.all([...9 deleteOlderThan...])` — **all 9 tables pruned concurrently**.
- **Why it's a problem:** Running 9 concurrent batched-delete loops is fine on a small DB, but each loop can run up to 10,000 batches (50M rows). Nine concurrent delete loops at 5000 rows each contend for the same connection pool and can pressure `api_telemetry_events` / `flow_alerts` — tables the live app also writes to constantly. At 3 AM ET this overlaps with the nighthawk pipeline window edges. No statement_timeout is set here (**Not verified — needs DB config**).
- **Impact (500 users):** `api_telemetry_events` grows ~30k rows/day at 10 users; at 500 users it could be 1–2M rows/day (every tracked fetch logs). The 7-day-retention delete then removes ~10M rows/night — nine concurrent loops doing that can spike DB load and write-latency for the live app during the cleanup window.
- **Recommended fix:** Run the 9 deletes **sequentially**, not concurrently (`for … await` instead of `Promise.all`), so only one table is locked at a time. Add a per-statement `statement_timeout`. Scale telemetry retention down (or sample telemetry writes) before 500 users — 1–2M rows/day of telemetry is the table most likely to dominate cleanup.

---

### Finding C13 — Three-way registry drift (registry vs TOML vs route) is a standing correctness hazard for monitoring

- **Severity:** Medium
- **File:** `src/lib/cron-registry.ts`, `railway.*.toml`, `src/app/api/cron/**`
- **Code reference:**
  - `cron-registry.ts` key `nighthawk-playbook` (`:58`) but the route is `/api/cron/nighthawk-edition` and the TOML is `railway.nighthawk-playbook.toml` hitting `/api/cron/nighthawk-edition` — the key, route name, and TOML name all differ (the code uses `CRON_KEY = "nighthawk-playbook"` inside `nighthawk-edition/route.ts:9` to bridge them, which works but is non-obvious).
  - `membership-reconcile` label "Every 6h" vs TOML hourly (C2).
  - `gex-alerts`/`gex-eod-snapshot` in neither registry nor TOML (C1).
  - `market-api-auth.ts:11` comment says *"the single auth gate for all 9 cron writers"* — there are now **12** cron routes. The comment (and any "9 crons" mental model) is stale.
- **Why it's a problem:** Monitoring correctness depends entirely on the registry matching reality. Every drift either creates a blind spot (job not monitored) or a wrong threshold (stale label). The "9 cron writers" comment shows the count has already grown past what the code's own documentation assumes.
- **Impact (500 users):** Ops trusts a dashboard that doesn't reflect what's actually scheduled. New crons get added (as gex-* were) without monitoring.
- **Recommended fix:** Make `CRON_JOBS` the single source: generate/validate the `railway.*.toml` schedules from it (or a CI check that every `src/app/api/cron/*` route has both a registry entry and a TOML, and vice-versa). Fix the stale "9 cron writers" comment.

---

## 4. What happens if each cron fails silently

| Cron | Silent-failure blast radius |
|---|---|
| flow-ingest | Flow feed stops updating (if WS also down). Recovers next cycle via cursor; gap ≤ a few min. Watchdog catches at 15 min stale. |
| spx-evaluate | SPX play/lotto/power-hour stop evaluating → no new plays, no force-exit at 3:50 PM. **High user impact.** Heartbeat blend may mask it (C10). |
| uw-cache-refresh | UW market-wide signals serve stale Redis → eventually empty after TTL → live routes fall back to per-request UW (amplifies 2 rps pressure). Partial failures invisible (C8). |
| nights-watch-warm | Night's Watch GETs stop being cache hits → per-user Polygon fetches (the exact thing it prevents) → Polygon pressure at 500 users. |
| nighthawk-edition | No evening edition published → flagship Night Hawk content missing. Checkpoint-resumable, so a later fire recovers if scheduler still runs. |
| nighthawk-outcomes | Play outcomes never resolved → win-rate stats frozen/wrong → erodes product trust. |
| membership-reconcile | **Revenue + access:** paid users locked on `free`, churned users keep `premium`. Loose 13h stale threshold hides it half a day (C2). |
| db-cleanup | Tables grow unbounded → DB bloat, slower queries, eventual disk pressure. At 500 users telemetry growth is the fastest (C12). |
| largo-cleanup | Stale Largo sessions accumulate → DB bloat only. Low impact. |
| cron-staleness-watchdog | **Meta-failure: nothing watches the watchers.** If this dies, every other silent failure goes unalerted. No self-check exists (C5). |
| gex-alerts / gex-eod-snapshot | Already silently dead (C1) — no day-over-day heatmap context; no push alerts. |

---

## 5. Monitoring & alerting recommendations (priority order)

1. **Add a second alert channel** (email/PagerDuty) for `critical`, independent of Discord (C5).
2. **Register + schedule the two GEX crons**, or delete the routes if unused (C1).
3. **Make the rate-limiter cluster-safe before scaling web replicas**: require `REDIS_URL`, set per-replica `UW_MAX_RPS = 2/N`, move UW cache-warming to a dedicated lane/worker (C3, C6).
4. **Alert on partial/chronic failure**, not just total failure — read the `meta_json` counts the watchdog already loads (C8).
5. **Self-check the watchdog**: a daily "all healthy" heartbeat so a silent alert pipeline is itself detectable (C5).
6. **Add client-side timeouts** to `hit-cron.mjs` and explicit `maxDuration` on every route (C9).
7. **Fix the membership-reconcile cadence/label/threshold mismatch** and bound it with a resume cursor + concurrency pool (C2).
8. **Reconcile the registry/TOML/route drift** with a CI check; fix the stale "9 cron writers" comment (C13).
9. **Run db-cleanup deletes sequentially** with a statement_timeout; plan telemetry retention for 500-user write volume (C12).
10. **Decide WS topology before scaling**: single socket service or leader-elected socket holder to avoid `code=1008` collisions (C11).

---

## 6. Launch blockers (must-fix before 500 concurrent users)

1. **C3 — Per-process rate limiters + unset web `numReplicas`.** Scaling the web tier to serve 500 users multiplies UW/Polygon RPS and breaks the UW 2 rps ceiling whenever Redis blips (fail-open). This is the core scaling contradiction and must be resolved before adding replicas.
2. **C11 — Per-replica WebSockets.** Adding web replicas causes `code=1008` socket collisions and reconnect storms that destabilize the live data feeds for all users.
3. **C5 — Single-channel alerting with no fallback.** At 500 users a silent failure of membership-reconcile (lockouts/revenue) or flow-ingest must page someone; today one misconfigured Discord webhook makes every silent-failure guarantee void.
4. **C1 — Dead GEX crons + monitoring blind spot.** The flagship Heat Maps day-over-day feature is silently broken and invisible to the watchdog.

---

## 7. Things done well (for balance)

- CRON_SECRET auth is **constant-time** (`market-api-auth.ts:13-15`) and uniformly applied to all 12 routes.
- `flow-ingest` uses a **cross-replica `pg_try_advisory_lock`** + `alert_id UNIQUE` dedup — genuinely concurrency-safe.
- Most crons are **cache-readers** (spx-evaluate, gex-alerts, gex-eod-snapshot, nights-watch-warm by design), honoring the "per-user features never hit upstream" rule.
- Dual-band UTC schedules (`20,21` / `11-21`) correctly handle EDT/EST DST with in-route self-skip guards — a thoughtful pattern.
- Rate limiters have **cluster-aware circuit breakers** with pub/sub trip propagation and poison-clamping (`mergeBreakerOpenUntil`).
- The **watchdog-for-silent-death** concept (`cron-staleness-watchdog`) is exactly the right idea — it just needs registry completeness (C1) and a second alert channel (C5).
