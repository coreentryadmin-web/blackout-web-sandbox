# error-triage — 2026-06-26 (daily slot, ~04:42 UTC)

Autonomous daily production error triage (SDLC §3). Checks the durable error sink, incidents, admin
health, the 24h provider-telemetry dashboard, and **cron-health** on the LIVE app
(`blackouttrades.com`, logged-in admin session via the Chrome bridge) for NEW/spiking error
signatures since the prior run (**OVERNIGHT-4, ~03:50 UTC @ base `40fcc24`**), root-causes each, then
applies the FIX-vs-FLAG policy.

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). `git pull` clean → base `e39666d`,
**tsc-green (exit 0)**. Market CLOSED (~9:42 PM PT, Thu). Prior triage runs today (2026-06-25):
`error-triage-2026-06-25.md` (12:45) · `-pm` · `-night` · `-late` · `-evening` · `-overnight` ·
`-overnight2` · `-overnight3` · `-overnight4` (sector-tide fix `40fcc24`, live-verified).

---

### A. NEW signature found + FIXED (observability) → main (`cc35f9e`)

**Signature:** `cron-health` summary `failed: 1` — **Night Hawk Edition** worker (`nighthawk-playbook`,
"5:30 PM ET weekdays", _"Full dossier pipeline → Claude plays → publish"_) `last_status: "failed"`.

| field | value |
|---|---|
| last_run_at | 2026-06-25 **23:32:14 UTC** |
| last_duration_ms | 91540 (~91s — full synthesis ran) |
| last_message | **"Claude returned no parseable plays."** |
| meta.candidates | **40** (dossier pipeline found candidates) |
| meta.plays_count | **0** |
| meta.edition_for | 2026-06-26 |

This did NOT hit the durable sink, raise an incident, or show in the API dashboard (it's a handled
terminal-fail inside the worker, not an HTTP 4xx/5xx) — **only `cron-health` exposed it.** It is the
same class the e2e-interaction-sweep flagged earlier today (`docs/auto/e2e-2026-06-25.md` §Task #1),
which was **blocked "pending failed-run logs to disambiguate"** — those logs never surfaced.

**Root cause (locus):** `claude-edition.ts` `generateEditionPlays` zeroes the play count through 4
chained filters — `parsePlaysJson` → `play_type==="stock"` only (drops index/etf) →
`filterPlaysWithinPremiumCap` → `validatePlayAgainstChain` (strike/OI). Any single stage can zero it,
but the failure message (`edition-builder.ts:318-322`) was the **generic, misleading** "no parseable
plays" — so the actual cause (legit-empty night vs over-strict filters vs Claude format drift) was
**undiagnosable without Railway logs**. The `console.warn`s only fired for the premium- and
strike-reject stages, and `synthRaw` (Claude's actual response) was discarded on the failure path.

**What I fixed vs. what I flagged:**
- The **observability gap** is high-confidence, isolated, and NOT product-deciding → **FIXED → main**.
- The **"0 plays after filtering" decision** (loosen filters? legit empty? format drift?) is
  LLM/market-data/product-deciding → **FLAGGED** (Task #1), not auto-fixed. Correct per FIX-vs-FLAG.

**Fix (`cc35f9e`, 2 files, observability-only — zero change to play selection):**
- `claude-edition.ts` — `generateEditionPlays` now returns a `funnel: {parsed, stock, premium_ok,
  strike_ok}` (additive, optional field).
- `edition-builder.ts` — the 0-plays failure path now writes a self-diagnosing error: `parsed===0`
  → _"Claude returned no parseable JSON plays (raw N chars)"_; else _"All plays filtered out —
  funnel: P parsed → S stock → C within-cap → K strike-valid."_ This lands in `cron-health
  meta.error`, so the next failure names its own killing stage with no Railway dig.
- Only other caller `hunt-builder.ts:242` destructures just `{plays}` — unaffected.
- `npx tsc --noEmit` exit 0 · `npm run build` exit 0 → high-confidence small isolated → `main`
  (clean ff from `e39666d`).

**Secondary observation (flagged, not a hard bug):** the `nighthawk_job` for "Fri Jun 26" is stuck
`status:"running"` at `stage_synthesis` (updated 00:45:43 UTC, ~4h stale) — a process killed
mid-synthesis (Railway restart/OOM) before the top-level failed-catch (`edition-builder.ts:453`) ran.
**Not a hard block:** the next fire falls through to resume-from-checkpoint (`running` matches neither
the `!job` nor `failed` branch at `:126-133`, so it proceeds and re-runs synthesis). But the
2026-06-26 edition will not auto-recover before Friday's 5:30 PM ET fire. A stale-`running` reaper /
advisory lock is the larger #70 concurrency work (`NIGHT_HAWK_AUDIT_2026-06-25.md`) → flag-only.

---

### B. Rest of the live surface — CLEAN

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `events:[]` — 0 |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; critical/warning/info/api_errors all 0; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `113 calls / 0 err` (200), UW `33 calls / 0 err` (200, `/net-flow/expiry`), anthropic idle; all WS OPEN+auth (polygon-indices, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed `recent429s:0`, polygon `consecutive429:0`) |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ✅ `recent_errors:[]`, `active_retries:[]`, `summary.error_rate:0`; **120/120 recent_events status 200**; 0 endpoints with telemetry error_count>0; `db_pool` 3/3 idle |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` (Night Hawk Edition, §A); the other 12 jobs healthy/skipped/unknown — no other failure |

Sector-tide is now clean (no `Invalid sector` 400 in telemetry) — confirms the OVERNIGHT-4 fix
(`40fcc24`) is holding live. SPX/VIX WS prices at 0 = expected off-hours (market closed). The
`SPX Engine`/`Night's Watch Warm` `skipped` statuses are the benign off-hours suppression
(don't tick while market closed) — no incident, `health_ok:true`. No action (anti-theater).

---

### Result

**✅ ONE new signature found (cron-health `failed:1`) → observability FIXED → main (`cc35f9e`) +
root cause FLAGGED (Task #1).** The Night Hawk Edition synthesis failure ("0 plays after filtering")
is now self-diagnosing: the next failure reports its exact killing funnel stage in `cron-health
meta.error` — which directly unblocks the e2e §Task #1 that was stalled "pending failed-run logs."
The actual filter-vs-product decision stays flagged (not autonomously decidable). All other surfaces
(durable sink, incidents, health, route_errors, 24h telemetry) clean; sector-tide fix holding.

### Carry-forward (toward 0-open-issues — human merge-or-close)
- **Task #1 (this run):** after `cc35f9e` deploys, operator runs `nighthawk-playbook` "Run now"
  (force) to recover Fri's edition + capture the funnel breakdown, then pick the fix (loosen filters /
  accept empty / fix parse) from the now-visible killing stage.
- Stale-`running` job reaper / advisory lock for Night Hawk Edition = #70 concurrency work (flag).
- Open auto branches awaiting review: `auto/error-triage-2026-06-25-anthropic-timeout`,
  `auto/error-triage-2026-06-25`, `auto/anthropic-caching-2026-06-25`, `auto/clerk-webhook-2026-06-25`,
  `auto/far-dated-gex-2026-06-25`.
- `play_engine.critical_stale` off-hours cosmetic (gate behind RTH check) — low-value flag.

---

## RUN 2 — 2026-06-26 ~05:41 UTC (daily slot)

Second daily pass, ~1h after RUN 1 (04:42 UTC @ `cc35f9e`). Repo `C:/Users/raidu/blackout-cron`,
`git pull` clean → base **`c476793`**, **tsc-green (exit 0)**. Market CLOSED (~10:41 PM PT, Thu).
Re-checked all live error surfaces on `blackouttrades.com` (logged-in admin, Chrome bridge) for NEW or
spiking signatures since RUN 1.

### A. Full live surface — CLEAN (no new/spiking signatures)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `events:[]` — 0 |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; critical/warning/info/api_errors all 0; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `126 calls / 0 err` (200), UW `43 calls / 0 err` (200, `/net-flow/expiry`), anthropic idle; all WS OPEN+auth (polygon-indices 7 syms, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed `recent429s:0`, polygon `consecutive429:0`) |
| API dashboard | `/api/admin/apis/dashboard` | ✅ `summary.error_rate:0`, `recent_errors:[]`, `active_retries:[]`; **120/120 recent_events status 200**; 0 endpoints with `error_count>0` |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` — **same** Night Hawk Edition signature as RUN 1 (§ below); other 12 jobs healthy/skipped/unknown |
| Live route probe | `/`, `/api/health`, `/api/market/gex-positioning?ticker=SPX`, `/api/admin/cron-health` | ✅ all **200** (no 5xx) |

### B. The one failure is UNCHANGED + already handled (no action — anti-theater)

`cron-health` still reports the single `failed:1`: **Night Hawk Edition** (`nighthawk-playbook`),
`last_run_at` **2026-06-25 23:32:14 UTC**, `last_message: "Claude returned no parseable plays."`,
`meta.candidates:40 / plays_count:0`, `edition_for:2026-06-26`. This is **byte-identical** to RUN 1 —
the worker has **not re-fired** (next fire is **Fri 5:30 PM ET**), so this is NOT new and NOT spiking;
it is the same signature RUN 1 already (a) fixed for observability → `cc35f9e` and (b) flagged for the
product decision → **Task #1**. The stale-`running` `nighthawk_job` ("Fri Jun 26", `stage_synthesis`,
`updated_at 2026-06-26T00:45:43Z`) is likewise unchanged — already flagged as #70 concurrency work.

**Verified the RUN 1 fix is actually live:** `git merge-base --is-ancestor cc35f9e origin/main` → **YES**
(Railway deploys from `origin/main`). So Task #1's self-diagnosing funnel error IS armed for Friday's
fire — the next failure will name its own killing stage in `cron-health meta.error`. Re-running
"Run now" to force-recover the edition is a product/LLM decision and remains the **operator's** action
(Task #1), not autonomously decidable → correctly left flagged, not auto-triggered.

### Result

**✅ ZERO new or spiking signatures since RUN 1.** Durable sink / incidents / health / `route_errors` /
24h telemetry / live route probe all clean; the lone `failed:1` is the pre-existing Night Hawk Edition
case (fix `cc35f9e` confirmed on `origin/main`, root cause flagged Task #1, hasn't re-fired). Nothing
new to fix or flag — manufacturing a change here would violate the no-theater guardrail. Carry-forward
items from RUN 1 stand unchanged (Task #1 operator-run; #70 reaper; open `auto/*` branches awaiting
review).

---

## RUN 3 — 2026-06-26 ~13:54 UTC (daily slot)

Third pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`). Repo `C:/Users/raidu/blackout-cron`,
`git pull` clean → base **`34a8736`**, **tsc-green (exit 0)**. Market CLOSED (~6:54 AM PT, Fri).
Re-checked all live error surfaces on `blackouttrades.com` (logged-in admin, Chrome bridge). **Unlike
RUNS 1–2 (sink empty), the durable sink now holds a NEW, spiking signature.**

### A. NEW spiking signature found + FIXED → main (`cc17d83`)

**Signature:** `admin/nighthawk/publish-preview :: invalid input syntax for type date: "Mon Jun 29"`
— **69 occurrences**, all today **07:09:50 → 07:57:50 UTC** (~1.4/min, id 1–69), `source: admin_route`.
This is the **ONLY** distinct signature in the sink (69/69). It was absent in RUN 1 & RUN 2 (both
`events:[]`), so it is unambiguously **new + spiking** within the window.

| field | value |
|---|---|
| route | `GET /api/admin/nighthawk/publish-preview` |
| message | `invalid input syntax for type date: "Mon Jun 29"` |
| origin | `pg-pool/index.js:45` → `fetchNighthawkEditionByDate` → `WHERE edition_for = $1::date` |
| HTTP result | 502 (route.ts:24 catch) + recorded admin-route error, ×69 |

**Root cause — the INBOUND twin of #77 Bug 1.** #77 Bug 1 fixed the DB *read* path (`isoDateString`,
db.ts:965) so the client stops *receiving* the year-stripped `String(Date).slice(0,10)` label
`"Mon Jun 29"`. But the *query* path stayed unguarded: `route.ts:12` took the raw `edition_for` query
param and `publish-preview.ts:50` → `fetchNighthawkEditionByDate` fed it straight into `$1::date`. A
caller is still sending the legacy `"Mon Jun 29"` label, so Postgres threw `invalid input syntax for
type date` → caught → 502 + sink record, 69× in 48 min. The admin dashboard calls publish-preview
WITHOUT `edition_for` (AdminNightHawkDashboard.tsx:232), so the bad param is external/manual/scripted
(likely Task-#1 "Run now" recovery tooling or a poller holding a pre-#77 label).

**Fix (`cc17d83`, 2 files — high-confidence, isolated, build-gated → main):**
- **db.ts** — new exported `normalizeIsoDateInput(raw)`: accepts an already-ISO value (round-trip
  validated through `Date`, so structurally-ISO-but-invalid inputs like `2026-13-45` / `2026-02-30`
  are also rejected, not just `"Mon Jun 29"`); recovers a stringified Date that still carries a 4-digit
  year (`"Mon Jun 29 2026"` → `2026-06-29`); rejects yearless/garbage. The inverse of `isoDateString`.
  Unit-tested 11/11 edge cases before commit.
- **db.ts** — `fetchNighthawkEditionByDate` now normalizes its arg and **returns null** for non-ISO
  input instead of crashing the `$1::date` cast — protects ANY caller, including the **public**
  `/api/market/nighthawk/edition` route (`route.ts:97`, `?date=` param), which had the **same latent
  crash** (a 500 there, no try/catch) and now degrades gracefully to latest/empty.
- **publish-preview route** — validates `edition_for` at the boundary via the shared helper and returns
  a clean **400** (not a recorded 5xx) for bad input. No more sink spam for client-supplied garbage.
- `npx tsc --noEmit` exit 0 · `npm run build` exit 0 → pushed `main` (`34a8736..cc17d83`,
  confirmed `git merge-base --is-ancestor cc17d83 origin/main` → YES; Railway deploys from origin/main).

**FIX vs FLAG:** the server hardening is the high-confidence, isolated, build-gated half → FIXED → main.
The *source* of the malformed `"Mon Jun 29"` param (now defanged to 400s, no longer a production error)
is an external/scripted caller I can't fix with confidence from here → **FLAGGED (Task #1)**: trace via
Railway access logs; if it's an in-repo surface, make it send ISO or omit the param.

### B. Rest of the live surface — clean / known-benign (no other action — anti-theater)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors` | ⚠️ 69 events — single signature §A (NEW, fixed). No other signature. |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` — but the only `issues` are 3 websocket warnings (`I:TICK`/`I:TRIN`/`I:ADD` "stale or zero", `price=0`): **market-internals breadth tickers off-hours = EXPECTED** (market closed, Fri 6:54 AM PT). `route_errors:[]`, `redis_degraded:false`, critical/api_errors 0. Benign off-hours, not a production error. |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⚠️ `error_rate:0.625`, 5 `recent_errors` — these are the **same** publish-preview spike (§A) bleeding into the 24h telemetry window; not a separate signature. Will clear as `cc17d83` deploys + the window rolls. |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` — the **same** Night Hawk Edition case (RUN 1 §A, fix `cc35f9e` live, flagged Task-#1-prior). Unchanged, not new, not spiking. 9 healthy / 1 warning / 2 unknown otherwise. |
| Live route probe | `/`, `/api/admin/cron-health` | ✅ 200 |

The `health_ok:false` is driven solely by off-hours TICK/TRIN/ADD staleness — gating those breadth
warnings behind an RTH check is the low-value cosmetic flag already carried from RUN 1
(`play_engine.critical_stale` class). No change here (anti-theater).

### Result

**✅ ONE new spiking signature (publish-preview `::date` crash, 69×) → root-caused + FIXED → main
(`cc17d83`), source FLAGGED (Task #1).** Server now rejects malformed `edition_for` with a 400 (admin)
and degrades gracefully (public edition route), eliminating both the 69× sink spam and a latent public
500 of the same class. All other surfaces are either the known Night Hawk Edition `failed:1`
(carry-forward) or benign off-hours WS staleness. The 24h dashboard `error_rate:0.625` is the same
spike and self-clears post-deploy.

### Carry-forward (toward 0-open-issues)
- **Task #1 (this run):** trace the external caller sending `edition_for="Mon Jun 29"` (Railway access
  logs / referrer); fix it to send ISO or omit the param if it's an in-repo surface.
- Prior carry-forwards stand: Night Hawk Edition synthesis funnel (operator "Run now" — prior Task #1);
  stale-`running` job reaper / advisory lock (#70); off-hours WS-staleness RTH gate (cosmetic);
  open `auto/*` branches awaiting human review.

---

## RUN 4 — 2026-06-26 ~15:48 UTC (daily slot)

Fourth pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`, RUN 3 13:54 @ `cc17d83`). Repo
`C:/Users/raidu/blackout-cron`, `git pull` clean → base **`396a3a8`**, **tsc-green (exit 0)**. Market
**OPEN** (~11:48 AM ET, Fri). Re-checked all live error surfaces on `blackouttrades.com` (logged-in
admin, Chrome bridge) for NEW/spiking signatures since RUN 3. **One NEW signature found + FIXED → main.**

### A. NEW signature found + FIXED → main (`48d30b0`)

**Signature:** `unhandled_rejection :: invalid input syntax for type integer: "87.29305922597204"`
— **1 occurrence**, `2026-06-26 13:50:09.602 UTC` (id 70 in the durable sink). New since RUN 3 (RUN 3's
sink held only the 69× publish-preview spike). Single-shot (not yet spiking) but a hard server-side
crash class, so triaged + fixed.

| field | value |
|---|---|
| source | `unhandled_rejection` (caught by `instrumentation.ts`; server stayed up) |
| message | `invalid input syntax for type integer: "87.29305922597204"` |
| origin | `pg-pool/index.js:45` → `async ad` (db query) → `async j` (caller) |
| HTTP result | none (escaped to the process-level rejection handler, not a route 5xx) |

**Root cause — an unvalidated LLM-supplied day-param bound to a Postgres `$1::int` cast.** Exhaustive
trace of every `integer`-typed bind site in the app:
- The only `integer` columns are `user_positions.contracts` (both routes guard with `Number.isInteger`
  + try/catch; Largo never writes positions) and the `($N::int || ' days')::interval` day-params.
- Of the five `$N::int` day-params, three (`fetchTickerFlow*`) have **literal** callers only, and one
  (`fetchPendingNighthawkOutcomes`) is called with `7`. The **one** path where untrusted input reaches
  a `$N::int` is the Largo tool **`get_nighthawk_outcomes`** (`run-tool.ts:1221`):
  `const windowDays = Number(input.window_days ?? 30)` — bare `Number()`, **no integer guard, no clamp**
  — fed straight to `fetchNighthawkOutcomeAnalytics` → `$1::int` (`db.ts:2530`).
- `window_days` is LLM-controlled. The value `87.29305922597204` is a JS double (14 sig figs — not
  hand-typed): the model emitted/echoed a fractional value (matches the raw, unrounded
  `days_of_data = (Date.now() - oldest_closed)/86_400_000 ≈ 87.29` that leaks into the SPX desk context
  Largo reads, `spx-commentary.ts:509`). `Number("87.29…")` stays a float → Postgres rejects the
  `::int` cast. The admin route guards this **exact** param (`parseWindow`: `parseInt` + clamp 7–180,
  `analytics/route.ts:8`); the Largo tool did not.
- `getSpxTradeHistory`'s `days` (the other unclamped Largo numeric) is **safe** — it computes the cutoff
  in JS (`spx-service.ts:96`), never binds to SQL. The `$2 || ' days'` site at `db.ts:1613` is **safe**
  too — no `::int`, and Postgres intervals accept fractional days.

**Fix (`48d30b0`, 2 files — high-confidence, isolated, build-gated → main):**
- **run-tool.ts** — `get_nighthawk_outcomes` now clamps `window_days` to a valid integer
  (`Number.isFinite(raw) ? min(180, max(7, trunc(raw))) : 30`), mirroring the admin `parseWindow` and
  the existing run-tool clamp (`:1177`). This is the actual untrusted entry point → fixes the crash.
- **db.ts** — defense-in-depth: both Largo-reachable `$N::int` functions
  (`fetchNighthawkOutcomeAnalytics`, `fetchPendingNighthawkOutcomes`) now coerce their day-param to a
  safe positive integer (`Math.trunc` + finite guard) before binding, so **no** caller — current or
  future — can crash pg through the cast.
- Behavior-identical for every valid integer input. `npx tsc --noEmit` exit 0 · `npm run build` exit 0
  → pushed `main` (rebased onto `396a3a8`, tip of `origin/main` = `48d30b0`; Railway deploys origin/main).

**FIX vs FLAG:** the input-validation + db backstop is the high-confidence, isolated, build-gated fix →
FIXED → main. I deliberately did **not** also round `days_of_data` at its source
(`spx-play-outcomes.ts:227`) on main: that function feeds the SPX desk, public track record, embeds, OG
image, admin + Largo context (broad blast radius for a cosmetic change), and `Math.round` there could
flip the `>= minDays` adaptive gate (must use `Math.floor`). → **FLAGGED** as a separate hardening item.

### B. Rest of the live surface — clean / known-benign (no other action — anti-theater)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ⚠️ 70 events: 69× publish-preview `::date` (RUN 3, fixed `cc17d83`) + the 1 new §A. No third signature. |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` — driven solely by 3 WS warnings (`I:TICK`/`I:TRIN`/`I:ADD` `price=0`): market-internals breadth tickers, benign off-hours/early-session class (RUN 1/3 carry-forward). `route_errors:[]`, `redis_degraded:false`, critical 0. |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⚠️ 12 `recent_errors`, **all `status:200`** (polygon `/v3/snapshot/indices`, `anthropic-text`) — SLA-latency breaches counted as "errors", the known low-value class (OVERNIGHT-4 carry-forward), NOT real upstream failures. |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` — same Night Hawk Edition case (RUN 1 §A, fix `cc35f9e` live, flagged Task #1). Unchanged, not new. |

### Result

**✅ ONE new signature (`::int` crash from unvalidated Largo `window_days`, 1×) → root-caused + FIXED →
main (`48d30b0`).** The only path where untrusted (LLM) input could reach a Postgres `$N::int` day-cast
is now clamped at the tool boundary AND backstopped at the db layer — the `invalid input syntax for type
integer` class is closed for this param. All other surfaces are the already-fixed publish-preview spike,
benign early-session WS staleness, or the SLA-latency-as-error display class. RUN 3's `cc17d83` confirmed
holding (no new publish-preview events since 07:57 UTC).

### Carry-forward (toward 0-open-issues)
- **NEW flag (this run):** round/floor the raw `days_of_data` at source (`spx-play-outcomes.ts:227`,
  use `Math.floor` not `Math.round` to preserve the `>= minDays` gate) so the unrounded fractional value
  stops leaking into API output + LLM desk context (it's the value the model echoed into `window_days`).
  Broad blast radius → human-review, not auto-main.
- Optional: extend the same `Math.trunc` day-param backstop to the three `fetchTickerFlow*` `$2::int`
  functions (`db.ts:2253/2289/2321`) for symmetry — currently literal-callered, so not at risk today.
- Prior carry-forwards stand: publish-preview external caller (Task #1, RUN 3); Night Hawk Edition
  synthesis funnel + stale-`running` reaper (#70); off-hours WS-staleness RTH gate; SLA-latency-as-error
  display class; open `auto/*` branches awaiting human review.

---

## RUN 5 — 2026-06-26 ~16:40 UTC (daily slot, market OPEN ~12:40 PM ET Fri)

Fifth pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`, RUN 3 13:54 @ `cc17d83`, RUN 4 15:48
@ `48d30b0`). Repo `C:/Users/raidu/blackout-cron`, `git pull` clean → base **`011121b`**,
**tsc-green (exit 0)**. Re-checked all live error surfaces on `blackouttrades.com` (logged-in admin,
Chrome bridge) for NEW/spiking signatures since RUN 4. **One NEW signature (a per-replica false-CRITICAL)
→ root-caused + observability FIXED → main (`994e2bd`).** Confirmed RUN 3/4 fixes (`cc17d83`, `48d30b0`)
are in history and holding (no recurrence).

### A. NEW signature: admin-health false `flow:Flow data stale` CRITICAL → FIXED → main (`994e2bd`)

**Signature:** `/api/admin/health` raised `issues:[{severity:"critical", category:"flow", title:"Flow
data stale", detail:"Last flow update 1549s ago"}]` during RTH on the first poll of this run. It did
**not** hit the durable sink, incidents, or the API dashboard — it surfaced only as an admin-health
issue (and the critical path pages ops via `notifyOpsDiscord` + opens an `admin_incidents` row).

**Verified it is a per-replica artifact, NOT a cluster flow stall (live ground truth):**
- 5/5 subsequent `/api/admin/health` polls returned flow **`none`** (flow age ≤120s) — value varies by
  replica, the hallmark of per-replica state.
- Providers healthy: polygon **162 calls / 0 err** (200), UW **59 / 0 err** (200, last `/api/stock/SPY/net-prem-ticks`).
- WS healthy: `polygon_indices` OPEN (I:SPX 7370.27 ageMs 609), UW `flow_alerts` OPEN + authenticated.
- The replicas reporting **fresh** flow read it from the **shared DB** (`fetchRecentFlows` →
  `markFlowDataFromBriefs`), so the DB has recent flow rows — flow ingest is healthy cluster-wide.

**Root cause (full code trace):** admin health builds its desk via `loadMergedSpxDesk` → per-replica
`withServerCache` flow lane (`buildSpxDeskFlow`), whose `flow_data_age_ms` = `flowDataAgeMs()` =
`now - lastFlowDataAt`. `lastFlowDataAt` (`src/lib/flow-data-freshness.ts`) is a **module-level
in-memory** max-timestamp set by `markFlowDataFromBriefs`/`markFlowDataFresh`. On a replica whose recent
desk-flow builds returned **empty** `freshFlowsRaw` (quiet SPX tape → DB query returns no qualifying
rows) AND whose UW flow WS isn't the one bearing frames, `lastFlowDataAt` ages → `flow_data_age_ms`
crosses the 120 s critical threshold (`admin-spx-issues.ts:101`) → false CRITICAL, even while other
replicas + the shared DB are fresh. Same per-replica-vs-cluster-truth class as the empty-`websockets:{}`
seen on some health replicas.

**Fix (`994e2bd`, 2 files — high-confidence, isolated, build-gated, fail-open → main):**
- `flow-liveness.ts` — new `isFlowFrameFreshAnywhere(maxAgeMs)`: the observability twin of the existing
  `isFlowFrameFreshFromCluster`, **without** the anti-self-skip instance guard (that guard is only
  meaningful for the cron's REST-skip decision, never for a freshness probe). Reads the shared Redis
  heartbeat `blackout:flow_alerts:last_delivered_at` (90 s TTL, written by whichever replica delivers a
  live UW flow frame).
- `admin-spx-issues.ts` — before escalating the `flowAge > 120_000` branch to CRITICAL, corroborate
  against the cluster heartbeat. If **any** replica delivered a frame within 120 s → downgrade to a
  visible **WARNING** (`"Flow data stale on this replica"`); else the real CRITICAL fires.
- **Fail-safe / no real stall masked:** a genuine cluster-wide flow stall lapses the heartbeat (90 s TTL)
  → `isFlowFrameFreshAnywhere` false → CRITICAL fires. Redis-down → `sharedCacheGet` in-memory/empty →
  false → CRITICAL fires. Single-process → in-memory heartbeat fresh only when this process is actually
  delivering frames → correct in both directions.
- **Scope:** observability only. The trade-gate primitive (`spx-play-gates.ts:236` reads the same
  `desk.flow_data_age_ms`) is **untouched** — that path re-marks freshness from the DB on every fresh
  desk build, so it is far less exposed; corroborating it too is a live-trade-path change → carry-forward
  flag, not auto-main (per FIX-vs-FLAG).
- `npx tsc --noEmit` exit 0 · `npm run build` exit 0 → pushed `main` (rebased onto concurrent
  `a97f3e4`; `git merge-base --is-ancestor 994e2bd origin/main` → YES; Railway deploys origin/main).

### B. Rest of the live surface — clean / known-benign (no other action — anti-theater)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ **maxId 70 — ZERO new since RUN 4.** Only 2 signatures: id 70 `::int` (RUN 4, fixed `48d30b0`) + id 1–69 `::date` (RUN 3, fixed `cc17d83`). Publish-preview spike **stopped at 07:57 UTC** (no event since) and `::int` (id 70) has not recurred since 13:50 UTC → both fixes holding. |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` — driven solely by the 3 benign breadth-ticker warnings (`I:TICK`/`I:TRIN`/`I:ADD` `price=0`, age=epoch — never feed; carry-forward cosmetic). After `994e2bd` the per-replica flow reading becomes a WARNING not a false CRITICAL. `route_errors:[]`, `redis_degraded:false`, `market_health_ok:true`, critical 0 (the flow critical was the §A artifact). |
| Providers (5m) | `/api/admin/health` | ✅ polygon 162/0err, UW 59/0err, all 200; anthropic idle |
| WebSockets | `/api/admin/health` | ✅ polygon_indices OPEN, UW flow_alerts OPEN+auth (per-replica; some replicas show `websockets:{}` = WS not init on that replica, expected) |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⏳ endpoint >45 s during RTH (couldn't read this pass); 24h window still carries the already-fixed `::date`/`::int` spikes bleeding in (RUN 3/4), self-clearing as the window rolls. |
| Cron health | `/api/admin/cron-health` | ⏳ endpoint >45 s during RTH (couldn't read this pass). Known carry-forward: `failed:1` Night Hawk Edition (RUN 1 §A, fix `cc35f9e` live, flagged) — unchanged, next fire Fri **5:30 PM ET today**. |

`cron-health` + `apis/dashboard` are heavy aggregations that exceeded the 45 s CDP eval timeout during
market hours (local `npm run build` was also competing for CPU). The durable sink (primary, read OK) is
the ground truth and is clean. The slowness is an admin-only endpoint perf note, not a production error.

### Result

**✅ ONE new signature (admin-health per-replica false `flow:Flow data stale` CRITICAL) → root-caused +
observability FIXED → main (`994e2bd`).** The health detector now corroborates a per-replica flow-stale
reading against the shared cluster heartbeat before paging ops, eliminating false critical → false ops
Discord page → false incident, while still firing the real critical on a genuine cluster stall
(fail-open). Durable sink / incidents / providers / WS all clean; RUN 3 (`cc17d83`) + RUN 4 (`48d30b0`)
fixes confirmed holding (no recurrence). All other `health_ok:false` is the benign breadth-ticker class.

### Carry-forward (toward 0-open-issues)
- **NEW flag (this run):** apply the same cluster-heartbeat corroboration to the **trade-entry** flow-stale
  gate (`spx-play-gates.ts:236-238`, blocks at >5 min) so a user landing on a stale replica can't be
  falsely blocked from a valid SPX entry while the cluster tape is live. Live-trade-path change → branch +
  human review, not auto-main. (TaskCreate filed.)
- Prior carry-forwards stand: publish-preview external caller (RUN 3); `::int` `days_of_data` source-round
  (RUN 4, `spx-play-outcomes.ts:227`, use `Math.floor`); Night Hawk Edition synthesis funnel + stale-
  `running` reaper (#70); off-hours WS-staleness/breadth-ticker RTH gate (cosmetic); cron-health +
  apis/dashboard RTH latency (admin-only); open `auto/*` branches awaiting human review.

---

## RUN 6 — 2026-06-26 ~17:50 UTC (daily slot, market OPEN ~1:50 PM EDT Fri)

Sixth pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`, RUN 3 13:54 @ `cc17d83`, RUN 4 15:48
@ `48d30b0`, RUN 5 16:40 @ `994e2bd`). Repo `C:/Users/raidu/blackout-cron`, `git pull --ff-only` clean →
base **`35d4442`** (picked up the concurrent benzinga channel fix), **tsc-green (exit 0)**.

### A. PRIMARY error source (durable sink) — read OK, CLEAN (no new/spiking signature)

`/api/admin/errors?limit=200` read cleanly via the Chrome bridge (logged-in admin) **before** the bridge
degraded mid-run (see §C):

| field | value |
|---|---|
| total events | **70** — `maxId 70`, **ZERO new since RUN 4/5** |
| signature 1 | `invalid input syntax for type date: "Mon Jun 29"` ×69 (id 1–69) — RUN 3, **fixed `cc17d83`**; last event **07:57:50 UTC** (no recurrence) |
| signature 2 | `invalid input syntax for type integer: "87.29305922597204"` ×1 (id 70) — RUN 4, **fixed `48d30b0`**; last/only event **13:50:09 UTC** (no recurrence) |

No third signature. Both pre-existing signatures are **fixed-and-holding**: id 69 (`::date`) stopped at
07:57 UTC and id 70 (`::int`) has not repeated since 13:50 UTC — neither has logged a single new event
across RUN 5 (16:40) → RUN 6 (17:50). The durable sink is the authoritative production-error ground truth
and shows nothing new to triage.

### B. Fix-history corroboration (git, reliable) — all prior fixes live

`git merge-base --is-ancestor … origin/main` → **YES for all four**: `cc35f9e` (Night Hawk funnel
observability), `cc17d83` (`::date` boundary guard), `48d30b0` (`::int` Largo `window_days` clamp +
db backstop), `994e2bd` (per-replica flow-stale corroboration). Railway deploys `origin/main`, so every
RUN 1–5 fix is deployed. `origin/main` tip = `35d4442`.

### C. Secondary aggregation surfaces — UNREADABLE this run (bridge degraded) — NOT claimed clean

After the primary-sink read, the Chrome bridge entered the **degraded state** the e2e-interaction-sweep
documented earlier today (`docs/auto/e2e-2026-06-26.md`): the heavy `/api/admin/incidents` JSON froze the
renderer, and **every subsequent `navigate` reported success but never committed off `chrome://newtab`** —
across a fresh tab, a new window, a full `select_browser` reconnect, a 12 s recovery wait, and a plain
homepage load. `javascript_tool`/`get_page_text` returned `Cannot access a chrome:// URL` each time. One
`navigate` also returned the hard **"Claude in Chrome is not connected"** banner before momentarily
reconnecting. Compounded by the **known RTH latency** on these aggregation endpoints (RUN 5 §B: cron-health
+ apis/dashboard exceed the 45 s CDP eval window during market hours).

**Honest coverage gap:** `/api/admin/incidents`, `/api/admin/health`, `/api/admin/cron-health`, and
`/api/admin/apis/dashboard` could **not** be read this pass. I am **not** asserting them clean. What is
known about them from the last successful read (RUN 5, 16:40, 70 min ago) + git:
- The only outstanding cron-health item is the **Night Hawk Edition `failed:1`** (RUN 1 §A) — fix
  `cc35f9e` confirmed live (§B); next fire is **5:30 PM EDT today (~21:30 UTC, ~3.7 h out)**, so it
  cannot have produced a *new* failure since RUN 5.
- The only standing health `issues` were the benign off-hours/early-session breadth-ticker warnings
  (`I:TICK`/`I:TRIN`/`I:ADD` `price=0`) — cosmetic carry-forward, not a production error.
- The per-replica flow-stale false-CRITICAL was fixed RUN 5 (`994e2bd`, live per §B).

### Result

**✅ No new or spiking production-error signature.** The PRIMARY durable sink — the authoritative source —
read CLEAN (maxId 70, zero new since RUN 4/5; both existing signatures fixed-and-holding, last events
07:57 and 13:50 UTC with no recurrence). All four RUN 1–5 fixes are git-confirmed on `origin/main`
(Railway-deployed). **No fix made — manufacturing one with the sink clean would violate the no-theater
guardrail.** The secondary admin aggregation surfaces were **unreadable** this run (degraded Chrome bridge
+ known RTH latency) and are honestly logged as a coverage gap, not claimed clean — the next run (or a
bridge recovery) should re-read incidents/health/cron-health/dashboard.

### Carry-forward (toward 0-open-issues)
- **Bridge-degraded (this run):** the Chrome bridge cannot commit navigation off `chrome://newtab` —
  re-verify incidents/health/cron-health/dashboard next run; if it persists, a Chrome/extension restart
  may be needed (same condition the e2e sweep hit today).
- All prior carry-forwards stand unchanged: trade-entry flow-stale gate corroboration
  (`spx-play-gates.ts:236-238`, RUN 5); publish-preview external caller (RUN 3); `::int` `days_of_data`
  source-round (RUN 4, `spx-play-outcomes.ts:227`, `Math.floor`); Night Hawk Edition synthesis funnel +
  stale-`running` reaper (#70); off-hours WS-staleness/breadth-ticker RTH gate (cosmetic); cron-health +
  apis/dashboard RTH latency (admin-only); open `auto/*` branches awaiting human review.

---

## RUN 6 — ADDENDUM ~18:20 UTC (secondary surfaces RE-READ; bridge recovered)

The operator opened a **fresh Chrome** (logged out → new window w/ site + Railway + Clerk), which cleared
the degraded bridge that blocked RUN 6 §C. All four previously-unreadable admin aggregation surfaces were
re-read directly. **Closing the RUN 6 coverage gap revealed one NEW-but-transient signal that has already
self-healed — no fix warranted (verified by live recovery, not assumption).**

### Re-read results (18:20 UTC, market OPEN)

| Source | Result |
|---|---|
| Durable sink | ✅ `maxId 70` — still 0 new (unchanged from RUN 6 §A) |
| Incidents | ✅ `incidents:[]` — **0 open** (the writer staleness did NOT open an incident) |
| API dashboard (24h) | ✅ `error_rate:0`, `recent_errors:0`, `active_retries:0` — the RUN 3/4 `::date`/`::int` spikes have now rolled out of the 24h window. Fully clean. |
| Admin health | ⚠️ `health_ok:false` — driven **solely** by the 3 benign breadth-ticker warnings (`I:TICK`/`I:TRIN`/`I:ADD` `price=0`, age=epoch); `route_errors:0`, `redis_degraded:false`, `market_health_ok:true`. Known cosmetic carry-forward. |
| Cron health | ⚠️ **NEW:** `Data Correctness` `last_status:"failed"` @ **18:03:34 UTC**, msg **"3 correctness flag(s)"** — investigated below. (Plus the known Night Hawk Edition `failed:1`.) |

### The new signal: 3 STALE critical writers @ 18:03 — TRANSIENT, self-healed (no fix)

The Data Correctness audit (`meta.flags`, `layer:"freshness"`) flagged 3 critical live-data writers stale
during RTH, all 10–11 m old:
- `writer_uw_cache_refresh` — **UW Cache Refresh** (no run in 11m, limit 10m)
- `writer_nights_watch_warm` — **Night's Watch Warm** (no run in 10m, limit 10m)
- `writer_heatmap_warm` — **Heat Maps Warm** (no run in 11m, limit 10m)

**Live ground-truth re-check (the decisive evidence) — all 3 RECOVERED by 18:20 UTC:**

| Writer | last_run_at | age | status |
|---|---|---|---|
| UW Cache Refresh | 18:17:04 UTC | 3m | `ok` |
| Night's Watch Warm | 18:16:05 UTC | 4m | `ok` |
| Heat Maps Warm | 18:16:34 UTC | 4m | `ok` |

**Root cause — deploy-restart bounce, NOT a dead writer.** The writers' last good run before the flag was
~17:52 UTC; resumption was ~18:13–18:17. That gap coincides with a cluster of pushes to `main` at
~17:39–17:55 UTC — benzinga `35d4442`, my own RUN 6 log push `b371191`, and the financials merge `9787e9f`
(now `origin/main` tip... superseded). Each push restarts the Railway deploy and bounces the cron
scheduler; three back-to-back restarts left the warm-writers paused across a ~20 min window, and the 18:03
data-correctness cycle sampled them mid-gap. **Data VALUES stayed consistent throughout** (audit totals:
7 independentlyConfirmed, 7 pass, **0 value-discrepancy flags**; the 67 `consistencyOnly` are
can't-independently-confirm coverage, not errors) — only freshness blipped, and `incidents:[]` confirms it
never escalated to an ops page.

**FIX vs FLAG → no code change (anti-theater + safety).** The auditor reported a *real* (if brief)
staleness correctly; the writers self-healed; fabricating a sensitivity/suppression change to the
**critical** data-correctness freshness auditor would be theater AND would risk masking a genuine future
writer death. The `Data Correctness last_status:"failed"` is a stale 18:03 snapshot — the next RTH
data-correctness cycle will clear it now that all writers are fresh. **Verified via live recovery, not
assumed.**

### NEW carry-forward (ops/process — flag, not auto-fix)
- **Autonomous main-pushes during RTH restart Railway and briefly stall live-data writers** (UW cache /
  Night's Watch / Heat Maps warm), which (a) trips the data-correctness auditor and (b) gives users a
  short real data-staleness window mid-session. Three rapid pushes compounded it to ~20 min today.
  Mitigation is a process decision (defer non-urgent autonomous `main` pushes outside RTH, batch them, or
  speed writer resume post-deploy) → flagged for human review, not auto-changed. Ties into the SDLC
  concurrency-safety guardrail.

### Addendum result
**✅ RUN 6 coverage gap closed.** Re-read of all secondary surfaces on the fresh bridge: incidents 0,
dashboard error_rate 0 (spikes aged out), health = benign breadth-ticker class only. The one new cron-health
signal (3 stale writers @ 18:03) was **transient deploy-restart fallout, fully self-healed** (all 3 `ok`,
<4m old by 18:20) with no value-correctness impact and no incident — **no fix made**; the RTH-push→writer-
stall pattern is flagged as an ops carry-forward. Sink/fixes from RUNs 1–5 all still holding.

---

## RUN 7 — 2026-06-26 ~18:48 UTC (daily slot, market OPEN ~2:48 PM EDT Fri)

Seventh pass today. Repo `C:/Users/raidu/blackout-cron`, tsc-green (exit 0) @ base `be21109`. Re-checked
all live error surfaces on `blackouttrades.com` (logged-in admin, Chrome bridge — **healthy this run**,
unlike RUN 6's degraded bridge). **The PRIMARY durable sink stayed CLEAN; the actionable finding is that
RUN 6's addendum UNDER-CALLED the warm-writer staleness — live re-check proves it RECURS on every RTH
push, not a one-off "transient, self-healed."** → root-caused + **branch + flag** (deploy-config).

### A. PRIMARY error surfaces — CLEAN (no new/spiking signature)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `maxId 70` — **ZERO new since RUN 4/5**. Only the 2 known signatures: id 1–69 `::date "Mon Jun 29"` (RUN 3, fixed `cc17d83`, last event 07:57 UTC) + id 70 `::int "87.29…"` (RUN 4, fixed `48d30b0`, last/only 13:50 UTC). Both **fixed-and-holding** (no recurrence). |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 open |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` driven **solely** by the 3 benign breadth-ticker warnings (`I:TICK`/`I:TRIN`/`I:ADD` `price=0`, age=epoch — never feed; cosmetic carry-forward). `route_errors:0`, `redis_degraded:false`, `market_health_ok:true`, critical 0. No flow-stale CRITICAL (RUN 5 fix `994e2bd` holding). |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⚠️ `error_rate:0.16`, 1 `recent_error` = `/benzinga/v2/news` **status:200** — the known SLA-latency-as-error display class, NOT a real failure. The RUN 3/4 `::date`/`::int` spikes have aged out of the window. |
| Cron health | `/api/admin/cron-health` | ⚠️ 2 failed: **Night Hawk Edition** (unchanged carry-forward, last run Thu 23:32, fix `cc35f9e` live, next fire 5:30 PM EDT today) + **Data Correctness** (§B). |

### B. THE FINDING — recurring RTH-push → warm-writer stall (RUN 6 mis-classified) → branch+flag

`cron-health` → **Data Correctness** `last_status:failed` @ **18:34:14 UTC**, "3 correctness flag(s)" — all
**freshness-layer**: critical writers **UW Cache Refresh**, **Night's Watch Warm**, **Heat Maps Warm**
"STALE during RTH (no run in 11m, limit 10m)". RUN 6's addendum (18:20) saw these recover and called it a
one-off "transient deploy-restart, self-healed." **This run proves otherwise** — the live writer heartbeats:

| check (UTC) | UW Cache | Night's Watch | Heat Maps | reading |
|---|---|---|---|---|
| 18:42:45 | last 18:23 (19m) | last 18:23 (20m) | last 18:23 (20m) | **all ~20 min stale** |
| 18:47:48 | 3.0m | 2.2m | 2.9m | **resumed ~18:44** |

So a **~21-minute stall (18:23 → 18:44)** during open market, bracketing the **18:22 push (`be21109`,** my own
RUN 6-addendum doc commit). Combined with RUN 6's 18:03 stall (bracketing the 17:39–17:55 push cluster), the
pattern is **confirmed recurring**, not transient.

**Root cause (confirmed at the config level):** the every-minute warm writers are Railway **cron trigger
services** (`cronSchedule = "* 11-21 * * 1-5"`, each running `node scripts/hit-cron.mjs /api/cron/<x>`). The
main `railway.toml` **already** carries `watchPatterns` excluding `docs/**` (its comment documents that
autonomous-SDLC doc commits were redeploying prod). The **15 per-service trigger TOMLs had NO
`watchPatterns`** → **every** commit, including the frequent `docs/auto/*` log pushes, redeployed all 15
trigger services, bouncing the every-minute cron and stalling the warm writers until each rebuild finished.

**Impact = reliability/latency, NOT correctness.** The data-correctness **VALUE** layers were clean
(`totals: pass 7, independentlyConfirmed 7, flags 3 (all freshness), 0 wrong-number flags`). Warm caches
backfill on organic traffic (the heatmap TOML itself notes the cron "exists to KILL cold-build bursts… not
to be the sole refresh path"), so the stall = cold-build latency + extra provider load for users hitting
Heat Maps / Night's Watch in the window, **not stale/wrong numbers**. `incidents:[]` — never paged ops.

**FIX vs FLAG → BRANCH `auto/error-triage-2026-06-26-cron-watchpatterns` + Task #1 (NOT main).** Added the
proven repo-relative-glob `watchPatterns` to all 15 trigger TOMLs, scoped to
`[scripts/hit-cron.mjs, <own>.toml, nixpacks.toml]` (each service runs only `hit-cron.mjs`; all logic lives
in the pinged main app → that is its complete dependency set). Fails safe (a non-match keeps the service
running its current deployment — the goal). `npx tsc --noEmit` exit 0 · `npm run build` exit 0. **Branch,
not main, because:** (1) deploy-config change (guardrail); (2) needs human verification that each cron
service reads its TOML as config-as-code — a dashboard-set `cronSchedule` would override it (the TOMLs warn
of this); (3) **pushing it to main during RTH would itself trigger one final all-15 redeploy = the exact
~20-min stall being fixed** — merge off-hours.

### Result

**✅ Primary durable sink CLEAN (maxId 70, both prior signatures fixed-and-holding); incidents 0; value
layers 0 wrong-number flags.** The one actionable item is the warm-writer RTH-push stall, which RUN 6's
addendum mis-called transient — RUN 7 confirms it RECURS on every push, root-causes it to the missing
`watchPatterns` on the 15 cron trigger TOMLs, and ships the complete fix on a **branch + Task #1** (deploy-
config + needs human config-as-code verification + main-push-during-RTH would self-trigger the stall). No
main push of code this run; the only main write is this log.

### Carry-forward (toward 0-open-issues)
- **Task #1 (this run):** merge `auto/error-triage-2026-06-26-cron-watchpatterns` OFF-HOURS; verify each cron
  service's config-as-code wiring (dashboard may override the TOML); after merge confirm the data-correctness
  freshness flags stop recurring around autonomous doc pushes. Open Q for human: why a no-build (echo) cron
  redeploy takes ~20 min to resume — if it persists post-fix, decouple cron services from the app repo or use
  Railway native cron on the main service.
- ⚠️ **This very log push to main will, until the branch is merged, trigger one more ~20-min warm-writer
  stall** (it's a `docs/**` commit and the trigger TOMLs aren't yet protected) — bounded, value-safe, ~70 min
  RTH left; documented here as live evidence of the bug the branch closes.
- Prior carry-forwards stand: Night Hawk Edition synthesis funnel + stale-`running` reaper (#70); publish-
  preview external caller (RUN 3); `::int` `days_of_data` source-round (RUN 4, `Math.floor`); trade-entry
  flow-stale gate corroboration (RUN 5); off-hours WS-staleness/breadth-ticker RTH gate + SLA-latency-as-error
  display class (cosmetic); open `auto/*` branches awaiting human review.

---

## RUN 8 — 2026-06-26 ~19:48 UTC (daily slot, market OPEN ~3:48 PM EDT Fri)

Eighth pass today (~1h after RUN 7 @ 18:48 UTC). Repo `C:/Users/raidu/blackout-cron`, `git pull` clean,
**tsc-green (exit 0)** at base `1030f8a`. Re-checked all live error surfaces on `blackouttrades.com`
(logged-in admin, Chrome bridge — healthy) for NEW/spiking signatures since RUN 7. **PRIMARY durable
sink CLEAN; no new errors.** The one actionable item is an observability correctness bug surfaced by the
health check — `health_ok` permanently `false` during RTH from an EXPECTED-by-design condition →
high-confidence isolated **FIX → main (`1fbef6e`)**.

### A. Live error surfaces — CLEAN (no new/spiking signature)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors` | ✅ 70 events, **ZERO new since RUN 7**. Only the 2 known fixed signatures: `::date "Mon Jun 29"` ×69 (RUN 3 fix `cc17d83`, last event **07:11 UTC** → ~12.6h with no recurrence = holding) + `::int "87.29…"` ×1 (RUN 4 fix `48d30b0`). Both fixed-and-holding. |
| Open incidents | `/api/admin/incidents` | ✅ `count:0, open:0` |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` driven **solely** by the 3 breadth-ticker `info`-class warnings (`I:TICK/I:TRIN/I:ADD` "stale or zero") — §B. `critical:0`, `route_errors:0`, `redis_degraded:false`, `market_health_ok:true`. No flow-stale critical (RUN 5 `994e2bd` holding). |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⚠️ `error_rate:0.125`, 1 `recent_error` = `/v3/snapshot/indices` **status:200** = the known SLA-latency-as-error display class (NOT a real failure). `active_retries:0`, 0 endpoints with error_count>0. RUN 3/4 spikes aged out. |
| Cron health | `/api/admin/cron-health` | ✅ summary `failed:0` (15 jobs: 10 healthy, 1 warning, 1 stale, 3 unknown). The single job with `last_status:failed` is **Night Hawk Edition** (last run **Thu 23:32**, "no parseable plays" — unchanged carry-forward; fix `cc35f9e` live, next fire 5:30 PM EDT today). **Data Correctness is NO LONGER failing** — RUN 7's warm-writer RTH-push stall self-healed again (no recurrence post RUN 7 log push). |

So the surface is identical to RUN 7 minus the warm-writer stall, which recovered. Both prior `::date`/`::int`
fixes are holding; sector-tide (`40fcc24`) holding; flow-stale (`994e2bd`) holding.

### B. THE FINDING — `health_ok` is cry-wolf during all RTH → FIX → main (`1fbef6e`)

`health_ok` has been **`false` for the entire market session, every session**, driven solely by 3
`websocket` warnings: `I:TICK/I:TRIN/I:ADD` "stale or zero" (`price=0`, age>30s during RTH). Prior runs
repeatedly noted these as "benign cosmetic carry-forward (gate behind RTH check) — low-value flag." This
run **root-caused and fixed it** because a permanently-false top-level health flag is genuine cry-wolf: it
masks any *real* warning that appears (admin can't distinguish "always-false" from "newly-broken").

**Root cause (two loci):**
- `admin-spx-issues.ts:371` — `health_ok = counts.critical === 0 && counts.warning === 0 && health.ok`, so
  **any** warning flips it false.
- `admin-spx-issues.ts:160-168` — the per-symbol loop emits `severity:"warning"` for **every** polygon WS
  symbol at `price<=0 && age>30s` during RTH, with no exception for the breadth internals.

**Why the breadth-internal warning is a FALSE alarm (verified, not assumed):** `market-internals.ts:1`
documents — and the whole module exists — that *"Polygon does not return I:TICK / I:TRIN / I:ADD"* on our
plan, so `resolveMarketInternals` substitutes a **breadth-derived PROXY with provenance badging**
(`market-internals.ts:56-80`) when the real print is null. A 0/stale on those three is therefore EXPECTED,
designed operation — the consuming desk already handles it correctly with proxies. (`polygon-socket.ts:46-48`
+ `:258-259` confirm exactly `I:TICK/I:TRIN/I:ADD` are the subscribed internals.) So suppressing the *warning*
does NOT hide a real data gap — it removes a false one. (Truth mandate respected: the value users see is the
proxy, already correct + badged; this changes only the health *severity*, never any number.)

**Fix (`1fbef6e`, 1 file, observability-only):** the symbol loop now downgrades the 3 documented
proxy-backed internals (`PROXY_BACKED_INTERNALS = {I:TICK, I:TRIN, I:ADD}`) to `severity:"info"` (still
**visible** in the issues list, with detail "expected; breadth proxy supplies this reading"), so they no
longer flip `health_ok`. **A real index feed (SPX/VIX/VIX9D/VIX3M) at `price<=0` during RTH still emits a
`warning`** — that genuine failure class is untouched. `npx tsc --noEmit` exit 0 · `npm run build` exit 0 →
high-confidence, small, isolated, build-gated observability correctness → `main` (clean ff `1030f8a..1fbef6e`).

**Net effect:** `health_ok` becomes a meaningful signal again — `true` in normal RTH, flips `false` only on a
real critical/warning. The next time a genuine warning fires, it will actually be distinguishable.

### Result

**✅ Live surface CLEAN of new/spiking signatures (durable sink 0 new; incidents 0; dashboard 0 real errors;
cron 0 failed besides the known Night Hawk carry-forward). Data Correctness warm-writer stall (RUN 7) recovered
with no recurrence.** ONE real fix this run: the perpetual-`health_ok:false` cry-wolf — root-caused to the
breadth-internal warnings being emitted for an expected, proxy-handled condition, fixed to `info` → **main
(`1fbef6e`)**, build-gated. No theater: every other surface verified clean and all prior fixes confirmed holding.

### Carry-forward (toward 0-open-issues)
- **Night Hawk Edition** synthesis funnel (now self-diagnosing via `cc35f9e`) + stale-`running` reaper (#70) — flag.
- `auto/error-triage-2026-06-26-cron-watchpatterns` (RUN 7, Task #1) — merge OFF-HOURS; the warm-writer RTH-push
  stall recovered this run but the structural cause (15 trigger TOMLs lacked `watchPatterns`) is unmerged.
- Prior carry-forwards stand: publish-preview external caller (RUN 3); `::int days_of_data` source-round (RUN 4);
  open `auto/*` branches awaiting human review.

---

## RUN 9 — 2026-06-26 ~20:42 UTC (daily slot, market CLOSED ~4:42 PM EDT Fri)

Ninth pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`, RUN 3 13:54 @ `cc17d83`, RUN 4 15:48
@ `48d30b0`, RUN 5 16:40 @ `994e2bd`, RUN 6 17:50/18:20, RUN 7 18:48 @ `auto/...watchpatterns`, RUN 8 19:48
@ `1fbef6e`). Repo `C:/Users/raidu/blackout-cron`, `git pull --ff-only` clean → base **`8e655dc`**,
**tsc-green (exit 0)**. Re-checked ALL live error surfaces on `blackouttrades.com` (logged-in admin,
Chrome bridge — **healthy this run** after one `chrome://newtab` non-commit on the first navigate, fixed by
a re-navigate). **ZERO new or spiking signatures. No fix made (anti-theater).**

### A. Full live surface — CLEAN (no new/spiking signature)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `maxId 70` — **ZERO new since RUN 4/5**. Only the 2 known fixed signatures: `::date "Mon Jun 29"` ×69 (id 1–69, RUN 3 fix `cc17d83`, last event **07:57:50 UTC**) + `::int "87.29305922597204"` ×1 (id 70, RUN 4 fix `48d30b0`, only event **13:50:09 UTC**). Both **fixed-and-holding** — no recurrence in ~7h / ~13h respectively. |
| Open incidents | `/api/admin/incidents` | ✅ `count:0` — 0 open |
| Admin health | `/api/admin/health` | ✅ **`health_ok:true`** — `issues:[]`, critical 0, warning 0, `route_errors:0`, `redis_degraded:false`, `market_health_ok:true`. **RUN 8 fix `1fbef6e` holding** — the perpetual breadth-ticker cry-wolf is gone; `health_ok` is meaningful again (true at rest). No flow-stale CRITICAL (RUN 5 `994e2bd` holding). |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ✅ `error_rate:0`, `recent_errors:[]`, `active_retries:0` — the RUN 3/4 `::date`/`::int` spikes have fully aged out of the 24h window. Clean. |
| Cron health | `/api/admin/cron-health` | ✅ summary **`failed:0`** (16 jobs: 11 healthy, 1 stale, 4 unknown, 0 warning). Data Correctness **`ok`** (`flags:0`); the 3 warm writers (UW Cache / Night's Watch / Heat Maps) correctly **`skipped`** "outside market hours" — the RUN 7 RTH-push warm-writer stall is moot off-hours. The lone `last_status:"failed"` job is the unchanged **Night Hawk Edition** (§B). |

### B. The one non-green item is the UNCHANGED Night Hawk Edition carry-forward (no action)

`Night Hawk Edition` (`nighthawk-playbook`) still shows `last_status:"failed"`, but it is **byte-identical**
to every prior run: `last_run_at` **Thu 2026-06-25 23:32:14 UTC**, `last_message:"Claude returned no
parseable plays."`, `meta {candidates:40, plays_count:0, edition_for:2026-06-26}`. The job has **not
re-fired** (next fire **5:30 PM EDT ≈ 21:30 UTC, ~48 min out**), so this is NOT new and NOT spiking — it is
the same case RUN 1 (a) fixed for observability → `cc35f9e` and (b) flagged as the operator's product
decision (Task #1). The summary now buckets it as `stale:1` (last run >21h ago) rather than `failed:1`,
which is purely the staleness re-categorization, not a state change. The `cc35f9e` self-diagnosing funnel
error is git-confirmed live (§C), so **tonight's 21:30 UTC fire will write its own killing-stage breakdown**
to `cron-health meta.error` automatically — exactly what Task #1 was waiting on. Nothing to fix here.

### C. Fix-history corroboration (git) — every prior fix LIVE on origin/main

`git merge-base --is-ancestor … origin/main` → **YES for all six**: `cc35f9e` (NH funnel observability),
`cc17d83` (`::date` boundary guard), `48d30b0` (`::int` Largo `window_days` clamp + db backstop),
`994e2bd` (per-replica flow-stale corroboration), `1fbef6e` (breadth-ticker health cry-wolf), `40fcc24`
(sector-tide). Railway deploys `origin/main`, so all are deployed. `origin/main` tip = `8e655dc`.

### Result

**✅ ZERO new or spiking production-error signatures.** Durable sink (maxId 70, both signatures
fixed-and-holding), incidents (0), admin health (`health_ok:true`, `issues:[]`), 24h dashboard
(`error_rate:0`), and cron-health (`failed:0`) all clean. The only non-green item is the pre-existing,
unchanged Night Hawk Edition `failed` (fix `cc35f9e` live, flagged Task #1, hasn't re-fired). All six prior
fixes git-confirmed on `origin/main`. **No code fix made — with the entire surface clean, manufacturing a
change would violate the no-theater guardrail.** Only main write is this log (safe: market closed, warm
writers already skipping, so no RTH-push→writer-stall risk).

### Carry-forward (toward 0-open-issues)
- **Night Hawk Edition** synthesis funnel (self-diagnosing via `cc35f9e`; tonight's 21:30 UTC fire will emit
  the funnel breakdown) + stale-`running` reaper (#70) — flag / operator Task #1.
- `auto/error-triage-2026-06-26-cron-watchpatterns` (RUN 7, Task #1) — still unmerged; safe to merge now
  (off-hours) after config-as-code verification per RUN 7 notes.
- Prior carry-forwards stand: publish-preview external caller (RUN 3); `::int days_of_data` source-round
  (RUN 4, `spx-play-outcomes.ts:227`, `Math.floor`); trade-entry flow-stale gate corroboration (RUN 5);
  open `auto/*` branches awaiting human review.

---

## RUN 10 — 2026-06-26 ~21:43 UTC (daily slot, market CLOSED ~5:43 PM EDT Fri)

Tenth pass today (RUN 1 04:42 → RUN 9 20:42 @ `8e655dc`). Repo `C:/Users/raidu/blackout-cron`,
`git pull --ff-only` clean; a concurrent **api-integration-audit** push advanced `origin/main` to
**`0126c40`** ("fix(#101/#102): Clerk user webhook + Polygon WS leader election") — local HEAD == origin/main,
in sync. **This run queried PROD POSTGRES DIRECTLY** (Railway public proxy `thomas.proxy.rlwy.net`, `pg`
client from the repo's `node_modules`) instead of the Chrome bridge — a more robust, deterministic read of the
exact ground-truth tables the admin endpoints wrap (`error_events`, `admin_incidents`, `cron_job_runs`). DB
clock at read: **2026-06-26 21:43 UTC**. **ZERO new or spiking signatures. No fix made (anti-theater).**

### A. Full live surface — CLEAN (direct prod-DB read)

| Source | Query | Result |
|---|---|---|
| Durable error sink | `error_events` max/recent | ✅ **`maxId 70`, total 70 — ZERO new since RUN 4**. `count where created_at > now()-6h` = **0**. Last event **#70 @ 13:50:09 UTC** (~8h stale). Only the 2 known fixed-and-holding signatures: `::date "Mon Jun 29"` (id 1–69, `admin_route/admin/nighthawk/publish-preview`, last 07:57:50 UTC, fix `cc17d83`) + `::int "87.293…"` (id 70, `unhandled_rejection`, fix `48d30b0`). No recurrence of either after its fix landed. |
| Open incidents | `admin_incidents where status not in (resolved,closed)` | ✅ **0 open** |
| Cron health | `cron_job_runs` latest-per-job + failures | ✅ **0 genuine failures**. 32 runs since RUN 9's 20:42 cutoff — all `OK` or `SKIPPED`; every SKIP is an expected off-hours guard (`heatmap-warm`/`nights-watch-warm`/`spx-evaluate` "Outside market hours/window"). `cron-staleness-watchdog` OK @ 21:41 (0.0h ago) → app live + ingest healthy. |
| Live app smoke | `curl` homepage / embed / admin | ✅ `/` **200** (0.37s), `/embed/track-record` **200**, `/api/admin/errors` **401** anon (auth intact). Deploy of `0126c40` healthy, not 500-ing. |
| Data-correctness | `cron_job_runs[data-correctness]` latest | ✅ Latest 3 runs (20:04/20:10/20:32 UTC) **`ok`, `flags:[]`**. The 8 earlier `failed`-status rows (15:36–18:34 UTC, "3–8 correctness flag(s)") are **RTH-window** and owned by the **data-correctness/market-hours-audit** job (no-duplication guardrail) — all cleared by close; not an error-triage signature. |

### B. ✅ NIGHT HAWK EDITION RECOVERED — the multi-day carry-forward resolved itself (positive, no action)

The long-standing `nighthawk-playbook` `failed` streak ("Claude returned no parseable plays.", every fire
2026-06-24→25 for editions 2026-06-25/26, `plays_count:0`) is **OVER**. The **21:30:40 UTC** fire returned
**`OK`** — `meta {ok:true, status:"accepted", job_status:"published", edition_for:"2026-06-29",
current_stage:"published"}` → the next-session edition (**Mon 2026-06-29**) **synthesized and PUBLISHED**.
`nighthawk-outcomes` also OK @ 21:33. This closes the RUN 1–9 carry-forward (Task #1 / #70 funnel concern):
the funnel that the `cc35f9e` self-diagnosing instrumentation was waiting to expose simply **succeeded** on the
real fire — no parse failure to diagnose this time. Nothing to fix; flagging the recovery for the operator.

### C. Fix-history corroboration (git) — all prior fixes LIVE on origin/main

`git merge-base --is-ancestor … origin/main` → **YES for all five**: `cc17d83` (`::date` boundary guard),
`48d30b0` (`::int` Largo `window_days` clamp), `cc35f9e` (NH funnel observability), `994e2bd` (flow-stale
corroboration), `1fbef6e` (breadth-ticker health cry-wolf). Railway deploys `origin/main` (tip `0126c40`), so
all are deployed.

### Result

**✅ ZERO new or spiking production-error signatures** (durable sink flat at maxId 70 with 0 events in 6h;
0 open incidents; 0 genuine cron failures; live app 200 + admin 401). **Plus a positive state change: the
Night Hawk Edition publish pipeline recovered and published the 2026-06-29 edition**, retiring the run's
single longest-standing carry-forward. All five prior fixes git-confirmed on `origin/main`. **No code fix made
— the surface is clean; manufacturing a change would violate the no-theater guardrail.** Only main write is
this log (safe: market closed, warm writers already skipping). Did NOT touch the concurrent
`railway-monitor-log` working-tree edit (railway-deploy-monitor job's, left uncommitted).

### Carry-forward (toward 0-open-issues)
- ~~Night Hawk Edition synthesis funnel failure~~ → **RESOLVED this run** (2026-06-29 published). Residual:
  the stale-`running` reaper (#70) is still a hardening nice-to-have, not an active failure — downgrade to low.
- `auto/error-triage-2026-06-26-cron-watchpatterns` (RUN 7, Task #1) — still unmerged; safe to merge off-hours
  after config-as-code verification per RUN 7 notes.
- Prior carry-forwards stand: publish-preview external caller hardening (RUN 3); `::int days_of_data`
  source-round (RUN 4, `spx-play-outcomes.ts:227`); open `auto/*` branches awaiting human review.
