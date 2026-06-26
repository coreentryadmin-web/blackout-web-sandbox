# error-triage — 2026-06-25 (OVERNIGHT-2 run, daily slot)

Autonomous daily production error triage (SDLC §3). **Seventh error-triage run today.** Checks the
durable error sink, incidents, admin health, and provider telemetry on the LIVE app
(`blackouttrades.com`, logged-in admin session via the Chrome bridge) for NEW/spiking error
signatures **since the prior run (OVERNIGHT, ~00:41 UTC @ base `d8f55d9`)**, root-causes each, then
applies the FIX-vs-FLAG policy.

Net-new code since the overnight run = **none**. The only commit since is `8f67895`
(`chore(sdlc): green-build-test-gate … NIGHTLY`) — docs/log-only. The most recent **code** commit on
`main` is still `5826ccc` (`fix(uw): RT-2 connect-blip resilience`). So this run is
**live-signal-directed**: the production telemetry pointed the investigation, not a code delta.

Prior logs today: `error-triage-2026-06-25.md` (12:45) · `-pm.md` (13:42) · `-night.md` (14:48) ·
`-late.md` (15:45) · `-evening.md` (23:40) · `-overnight.md` (00:41).

## Run @ 2026-06-26 ~01:41 UTC (autonomous; seventh error-triage run)

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). `git pull --rebase origin main` clean,
`main` @ `8f67895`, **tsc-green (exit 0)**. Market CLOSED (~9:41 PM ET, weekday).

---

### A. LIVE production triage (via Chrome bridge, logged-in admin session)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `{"ok":true,"events":[]}` — **0 durable error events** |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — **0 open** |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; `critical:0 / warning:0 / info:0 / api_errors:0`; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `126 calls / 0 err`, UW `43 calls / 0 err` (`last_status:200` `/net-prem-ticks`), anthropic idle (0 calls); all WS `OPEN`+authenticated (polygon-indices SPX 7357.49/VIX 18.89, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed, `recent429s:0`; polygon `consecutive429:0`) |
| API dashboard (24h) | `/api/admin/apis/dashboard` `window_min=1440` | ⚠️ **`errors_window:3` / `calls_window:554` / `error_rate:0.54%`** → 3 UW upstream-503s (see §B); `active_retries:[]`; `cross_errors_5m:0` (recovered) |

**ONE new signal since the overnight run** (`errors_window` 0 → 3) — three Unusual Whales upstream
**503s**, all inside a single ~13-second window, root-caused below and **verified fully absorbed by
the existing `uwGetSafe` resilience** (never user-facing). Durable sink, incidents, health, and
route-errors all remained CLEAN — confirming the blip never escalated to an app-level error.

---

### B. NEW signal root-caused — UW upstream-503 blip, VERIFIED HANDLED (no code defect)

The 24h API dashboard `recent_errors` held exactly 3 entries, all `provider:unusual_whales`,
`status:503`, `severity:p1`, within a 13-second window:

| # | at (UTC) | endpoint | reset reason |
|---|---|---|---|
| 1 | 01:26:54 | `/api/stock/SPX/spot-exposures/expiry-strike` | connect |
| 2 | 01:26:59 | `/api/stock/SPX/spot-exposures/expiry-strike` | connect |
| 3 | 01:27:02 | `/api/market/market-tide` | remote |

Body on all three: *"upstream connect error or disconnect/reset before headers"* — the classic
**Envoy/edge 503** from `api.unusualwhales.com`'s gateway during a momentary upstream connectivity
hiccup. NOT a rate-limit (UW limiter tokens were full, `recent429s:0`), NOT an auth failure
(`auth_failed:false`), NOT our code — a provider-side transient.

**Resilience chain traced end-to-end (all three endpoints route through `uwGetSafe`):**
1. `uwGet` (`unusual-whales.ts:116`) throws `Unusual Whales <path> → 503` on `!res.ok`.
2. `isUwUpstream5xx(msg)` (`uw-upstream-5xx.ts:6`, `/→\s*5\d\d\b/`) **matches** `→ 503` → the 5xx
   branch (`unusual-whales.ts:281-294`): bounded-backoff retry (`retries=2` ⇒ up to 3 attempts),
   then stale-cache fallback, else `return null`. It **never throws** and **never feeds the 429
   breaker** (`noteUw429` not called).
3. Telemetry footprint confirms the design firing: `expiry-strike` recorded **twice 5s apart** =
   attempt-1 + the backoff retry of **one logical call** (`fetchUwOdteGex` / `fetchUwOdteSpotExposuresByStrike`,
   `unusual-whales.ts:356/369`); the 3rd attempt (or stale fallback) recovered — UW now `last_status:200`.
   `market-tide` (`fetchUwMarketTide`, Redis-L2 + `uwGetSafe`, `:455`) single 503, likewise recovered.
4. Every caller is null-guarded (prior deep-passes' provider-null-propagation finder: 0 confirmed),
   so the worst case (`null`) degrades a desk panel to its last-good cache, not an error.

**Impact: none user-facing.** Cross-checked against every app-level surface: durable error sink
**empty**, **0** incidents, `health_ok:true` (all counts 0), `route_errors:[]`, `api_errors:0`,
`active_retries:[]`, UW `cross_errors_5m:0` now. The blip was isolated to that 13-second window and
did **not** recur (24h holds exactly these 3; 5m holds 0).

This is the **known RT-2 connect-blip class**, already covered by `5826ccc` + the 5xx branch. The
resilience worked **exactly as designed**. **No code defect → no fix, no new flag.** Fabricating a
change here would be theater (GLOBAL GUARDRAILS forbid it); the correct triage output is this
verified-benign root-cause.

---

### C. No deep-pass re-run this cycle (anti-theater, per GLOBAL GUARDRAILS)

Zero net-new source since the LATE run's exhaustive 6-finder latent-throw deep-pass (base `5826ccc`,
0 confirmed). `git diff 5826ccc..HEAD -- src` is **empty** — everything since is docs/log-only.
Re-running an identical audit over byte-for-byte-unchanged source is duplication the guardrails
forbid. This run is correctly scoped to the one live signal that moved — and it was chased to a
verified-benign root cause.

---

### Result

**✅ CLEAN (1 transient root-caused + verified handled).** One new telemetry signal since the
overnight run — a 13-second UW upstream-503 blip — root-caused to a provider-side Envoy gateway
hiccup and **confirmed fully absorbed** by the `uwGetSafe` 5xx retry + stale-cache fallback
(`5826ccc`): never threw, never hit the 429 breaker, never reached the durable sink / incidents /
health / users. All app-level surfaces stayed green. **No fix and no new flag this run** (no bug
found — the resilience did its job).

### Carry-forward (toward 0-open-issues convergence — human merge-or-close)
- **Task #1** — branch `auto/error-triage-2026-06-25-anthropic-timeout` (bounds 2 request-path
  anthropic callers to `{maxRetries:1, timeoutMs:20_000}`) OR adopt the AbortSignal total-deadline
  alternative OR close wontfix. Anthropic idle this run (0 calls).
- Branch `auto/error-triage-2026-06-25` — db-cleanup `allSettled` + options-socket map eviction.
- Other open auto branches awaiting review: `auto/anthropic-caching-2026-06-25`,
  `auto/clerk-webhook-2026-06-25`, `auto/far-dated-gex-2026-06-25`.
- Durable error sink persists across runs — re-check next run (empty this run).
- UW upstream-503 blips are now a recurring-but-fully-handled transient class (this run + prior
  observations). No action while the resilience absorbs them; only escalate if `errors_window`
  spikes sustained (many per window, not an isolated burst) or app-level surfaces light up.
- Pre-existing low-value hardening still open (no prod signature): client-side per-line `JSON.parse`
  at `api.ts:537`; `admin/health` `counts.api_errors` counts SLA-latency breaches as "errors";
  `spx-desk` "GEX Anchor" tone mismatch (#80, UI-owned).
