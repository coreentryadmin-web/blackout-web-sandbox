# error-triage — 2026-06-25

Autonomous daily production error triage (SDLC §3). Checks the durable error sink, incidents,
admin health, and provider telemetry on the LIVE app for NEW/spiking error signatures since the
last run, then runs a multi-agent deep-pass over the codebase for LATENT runtime-error risk.
FIX high-confidence small/isolated/build-gated bugs → `main`; branch + flag the rest.

## Run @ 2026-06-25 ~12:45 PT (autonomous; first error-triage run — no prior log)

**Result: ✅ PRODUCTION ERROR SURFACE CLEAN — 3 latent bugs fixed → main, 2 flagged → branch.**

Repo: `C:/Users/raidu/blackout-platform/blackout-web` (junction). Market was OPEN (RTH) during the run.
`main` advanced `4d051d3 → 9d99e11 → 0314e97` mid-run (concurrent jobs) — all pushes rebased clean.

---

### A. LIVE production triage (via Chrome bridge, logged-in admin session)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `{"ok":true,"events":[]}` — **0 durable error events** |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — none open |
| Admin health | `/api/admin/health` | ✅ `critical:0`, `route_errors:[]`, `redis_degraded:false`, `market_health_ok:true` |
| Provider telemetry | health snapshot | ✅ polygon 485 calls / **0 errors_5m**; UW 163 / **0**; anthropic 1 / **0**; circuits closed, 0×429 |
| API dashboard | `/api/admin/apis/dashboard?window_min=120` | ✅ `recent_errors:[]`, `active_retries:[]` over 2h |

**No NEW or spiking error signatures in production.** The two standing signals are both
already-understood NON-faults:

1. **3× `warning` — I:TICK / I:TRIN / I:ADD breadth indices `price=0` (never populated).**
   ROOT CAUSE: a **known data-source limitation** — the Massive/Polygon indices WS delivers
   I:SPX/I:VIX/I:VIX9D/I:VIX3M fine (all fresh, ageMs 89–13047) but does NOT carry the NYSE
   breadth indices on this plan. **Already handled gracefully:** `src/lib/market-internals.ts`
   ("Breadth-based estimates when Polygon does not return I:TICK/I:TRIN/I:ADD") substitutes
   estimates and `src/lib/providers/spx-desk.ts` badges them `est.`. The health "warning" is
   cosmetic; the app degrades cleanly. NOT a regression, NOT an error to fix. (Also noted by the
   railway-deploy-monitor as "likely persistent.") → no action.

2. **`counts.api_errors` = 2 → 1 (decaying), every provider `errors_5m:0`.**
   ROOT CAUSE: `recent_errors = recent.filter(e => !e.ok || e.sla_breach)` — the lone buffered
   entry was `polygon /v3/snapshot/indices` with **status 200, ok, empty error**, i.e. an
   **SLA latency breach** (`sla_breach = ok && latency_ms ≥ SLA_MS`, `SLA_MS=5000`): a slow-but-
   successful call to api.massive.com, NOT a failure. It decayed out of the window during the run.
   This is a perf signal (slow upstream snapshot), owned by `performance-audit`, not an error.
   OBSERVATION (logged, not fixed — semantics call): `admin/health` labels this count `api_errors`
   though it includes SLA breaches; harmless but can mildly inflate the "errors" reading.

---

### B. Deep-pass — latent runtime-error audit (6 finders → adversarial verify)

Workflow `error-triage-deep-pass`: 6 disjoint finders (api-routes · cron · providers · websockets ·
recent-25-commit regression · hot-path) → every "throws at runtime" finding adversarially verified
(real & reproducible? severity? fix-or-flag?). 17 agents, ~893k subagent tokens.

Raw per finder: api-routes 3, cron 3, providers **0**, websockets 2, regression **0**, hot-path 3.
After adversarial verification: **5 confirmed real, all LOW severity** (each verifier downgraded the
finder's inflated "high/medium / crash / OOM" framing — none crash the process or corrupt data; all
are error-shaping / fault-isolation / slow-leak). `providers` and `regression` finders found nothing
real → recent commits introduced no runtime-throw regressions.

#### ✅ FIXED → `main` (commit `3a50129`, tsc+build green, rebased clean)
Three unguarded `await`s that turned a transient-dependency blip into an opaque unhandled 500.
All defensive, happy-path-unchanged, mirroring existing patterns in their own files.

| # | File:line | Bug | Fix |
|---|---|---|---|
| 1 | `api/account/personal-alerts/route.ts:22` | GET's `getPersonalWebhook` hits Clerk Backend API (`users.getUser`) unguarded → 500 on a Clerk outage/rate-limit | try/catch → clean 502 (mirrors the file's PUT/DELETE) |
| 2 | `api/market/health/route.ts:19` | `buildMarketHealthSnapshot` fans out to unguarded `getPlayEngineHealth → loadOpenPlay/loadPlaySessionMeta` DB reads → 500 on a transient Postgres failure (admin ops endpoint) | try/catch → 502 |
| 3 | `api/cron/nighthawk-outcomes/route.ts:44` | `Number(?days)` unvalidated → `NaN` bound to `$1::int` → Postgres `invalid input syntax for type integer` (CRON_SECRET-gated; manual non-numeric param only) | `Number.isFinite(raw) && raw>0 ? raw : 7` |

#### ⚠️ FLAGGED → branch `auto/error-triage-2026-06-25` (commit `354c1ce`, tsc+build green)
Both real but verifier-recommended `flag-branch` (touch behavior worth a human glance). TaskCreate #1, #2.

| # | File | Bug | Fix on branch |
|---|---|---|---|
| 4 | `api/cron/db-cleanup/route.ts:97` | `Promise.all` over 9 table prunes — one table's transient DELETE failure aborts the whole batch, skipping the rest that night (self-heals next run; counts lost). Caught → 500, no crash. | `Promise.allSettled`; per-table independent; `ok` keyed off **rejections** not deletion count (fixes the verifier's "quiet-night false-fail" objection); partial failure → `ok:false` + `errors[]` |
| 5 | `lib/ws/options-socket.ts` | `optionMarks` Map written per Q frame, **no eviction path** → one entry per distinct OCC ever quoted, unbounded for process lifetime. Bounded in practice by held contracts + deploy restarts; reads null-gate. Slow leak, not OOM. | `optionMarks.delete(occ)` in `pool.unsubscribe` — ties eviction to subscription teardown; re-subscribe repopulates from next frame (Redis covers interim) |

---

### Notes / carry-forward
- **No production errors to triage** — durable sink, incidents, route-errors, provider-errors all empty; the only live warnings are the known-handled breadth-feed limitation + a slow-snapshot SLA breach.
- `providers` + `regression` deep-pass finders returned zero → recent 25 commits are runtime-clean.
- For the next run: re-check the durable error sink (it persists across runs); the 2 flagged branch items should be merged-or-closed by a human (drives toward the 0-open-issues goal).
- Possible future tidy (not done — semantics decision, low value): rename/relabel `admin/health` `counts.api_errors` so SLA breaches aren't counted as "errors".
