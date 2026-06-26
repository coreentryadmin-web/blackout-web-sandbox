# Night Hawk Edition — Comprehensive Audit (Task #77)

**Date:** 2026-06-25
**Scope:** Night Hawk Edition pipeline — cron trigger, build pipeline, candidate/dossier/scoring/synthesis/critic stages, LLM surfaces, read API, UI empty states, data dependencies, and the parallel Python "Playbook" scanner.
**Method:** 9 dimension audits + 3 adversarial root-cause verdicts, reconciled against a direct read of the load-bearing files. Every claim is cited `file:line`.
**Verdict in one line:** The architecture is **KEEP-AND-HARDEN**. The documented #77 cause (a synthesis-stage timeout/hard-kill) already has a correct fix in-tree; the remaining exposure is a set of fail-closed / fail-silent edges that can recreate the identical "being built" symptom and go unalerted.

---

## 1. THE VERIFIED ROOT CAUSE OF #77

### 1.1 What the code itself documents (PRIMARY cause — verified)

The cron route carries explicit in-code comments attributing #77 to a **function-timeout hard-kill during Claude synthesis**, not to empty data:

- `src/app/api/cron/nighthawk-edition/route.ts:12-18` — *"live finding #77: the build exceeded the old 300s and was hard-killed, so no edition published and the failure never reached /api/admin/errors."*
- `src/app/api/cron/nighthawk-edition/route.ts:101-106` — *"This is the fix for #77: previously a build that overran the function timeout was hard-killed by the host, so nothing published AND the failure never surfaced in /api/admin/errors."*

Mechanism: `buildEveningEdition` runs a heavy Stage 5 (option-chain prefetch + a ~4500-token Sonnet synthesis call + a second ~3000-token critic call). It overran the old ~300s `maxDuration`, the host killed the process mid-await, so `upsertNighthawkEdition` (publish, `edition-builder.ts:370+`) never ran → **no `nighthawk_editions` row** → GET falls through to `emptyEdition()` (`route.ts:99`) → UI renders the "publishes after the close" placeholder, which is what #77 reports as "being built." Compounding it, a non-`Error` throw serialized to `"[object Object]"` in `job.error`, hiding the cause from `/api/admin/errors` (see `serializeBuildError`, `edition-builder.ts:55-74`).

A secondary mechanism the verdicts retired entirely: the **trading-halt "fail-closed-on-stale" guard** noted in the #77 background. It is already fixed at `src/lib/nighthawk/dossier.ts:304-308`, which calls `shouldBlockForTradingHalt([sym], { failClosedOnStale: false })` with an explanatory comment — the overnight-quiet halts feed no longer marks every ticker halted and zeroes the edition. **This is no longer a live cause.**

### 1.2 What the dimension audits over-claimed (CORRECTED)

Four dimension audits independently asserted the root cause was: *"after the close, UW `/api/option-trades/flow-alerts` returns `[]`; the 30-min stale guard fail-closes; zero candidates → terminal failure."* All three adversarial verdicts rated this **PARTIAL** and the corrected reading holds up against the code:

1. **The flow-alerts endpoint is not date/time-windowed.** `fetchMarketFlowAlertRows` queries with only `limit` + `min_premium` (`market-wide.ts:220`; query built in `unusual-whales.ts` baseQuery). Post-close it returns the day's most-recent N alerts — the full RTH tape — not an empty array. "Returns empty after the close" is unsupported.
2. **The 30-min stale guard only runs on the error path.** `unusual-whales.ts:669-678` (return `[]`) lives **inside the `catch` block** at line 660. It is reached only when the live fetch *throws* (429 / circuit-open / 5xx). A successful post-close fetch never touches it — it caches `merged` and returns (`unusual-whales.ts:653-659`). Cache *expiry* forces a fresh live fetch; it does not produce `[]`.
3. **GET is not a bare `emptyEdition()` fall-through.** `edition/route.ts:85` does `fetchNighthawkEditionByDate(editionFor) ?? fetchLatestNighthawkEdition()`. Once any edition has ever published, the latest is served. The *perpetual* "being built" state requires that **no edition has ever published** (first-run / all-time-failure) — consistent with a brand-new launch-gated tool that has never had a clean build.

### 1.3 Net verdict on #77

- **PRIMARY (documented, fix shipped):** synthesis-stage timeout → hard-kill → no publish → invisible error. Fixed by `maxDuration=800` (`route.ts:19`) + `BUILD_TIME_BUDGET_MS` soft-deadline checkpoint/resume returning 202 (`route.ts:29-32, 107-149`) + `serializeBuildError` (`edition-builder.ts:55-74`) + the Railway service hitting the **HTTP route** rather than the crashing tsx worker (`railway.nighthawk-playbook.toml:5-11,17`).
- **SECONDARY (real, conditional, NOT routine):** if the single UW flow fetch *errors* (429/circuit/5xx) on a cold worker with an empty in-memory cache, candidates come back `[]` and Stage 2 fails terminally with no edition row (`edition-builder.ts:160-172`). This is incident-driven, not the nightly path, but it is a genuine single-point-of-failure that recreates the identical symptom.
- **Already neutralized:** halt fail-closed-on-stale (`dossier.ts:308`).

### 1.4 THE EXACT FIX

**P0-A — Confirm the shipped timeout fix is actually deployed (the load-bearing fix).** No code change; verification only:
- `src/app/api/cron/nighthawk-edition/route.ts:19` → `maxDuration = 800`; `:29-32` budget; `:107-149` checkpoint/resume.
- `railway.nighthawk-playbook.toml:17` runs `node scripts/hit-cron.mjs /api/cron/nighthawk-edition` (resume-capable HTTP nudge), **not** the tsx worker.
- Confirm in `/api/admin` (cron-run meta) that the build now completes across re-fires; if synthesis still can't finish inside the window, reduce `EDITION_SYNTHESIS_POOL` or land #103 (prompt caching / Message Batches).

**P0-B — Make the empty-candidates branch non-terminal.** In `src/lib/nighthawk/edition-builder.ts:160-172`, instead of `status:'failed'` with no row, upsert a **recap-only** edition (`plays:[]`, real `market_recap` from `buildMarketRecap(ctx)` — currently built later at ~`:288`, so hoist it). Then either render the recap even when `plays.length===0` (note `rowToNightHawkEdition` sets `available = plays.length > 0`, `edition-builder.ts:473`, so the contract/UI must treat a recap-bearing row as showable), or add a distinct recap-only UI state. This breaks the perpetual placeholder on a thin/incident night.

**P0-C — Stop a degraded UW fetch from caching/serving empty.** In `src/lib/providers/unusual-whales.ts:653-658`, guard the cache-set so an empty merged array is never stored as fresh — wrap in `if (merged.length)`. In the `catch` (`:669`), when outside RTH, serve the last good cache regardless of `MARKET_FLOW_MAX_STALE_MS` so an off-hours 429 degrades to the last RTH snapshot instead of `[]`.

> Do **not** adopt the dimension audits' headline remedy ("relax `MARKET_FLOW_MAX_STALE_MS` off-hours so the edition reads the session's final flow snapshot") *as the fix for #77* — the live endpoint already returns the day's tape post-close, so that change addresses a failure mode that is not the demonstrated cause. It is still worthwhile as defense-in-depth via P0-C.

---

## 2. ARCHITECTURE MAP + DESIGN VERDICT

### 2.1 The two parallel systems (no data link)

There are **two** "Night Hawk / Playbook" producers that share branding and upstream providers but nothing else:

- **(A) TypeScript "Night Hawk Edition"** — the web product. `blackout-platform/blackout-web/src/lib/nighthawk/*`. Writes the `nighthawk_editions` Postgres row the UI reads. **This is the system #77 is about.**
- **(B) Python "Playbook" scanner** — `C:/Users/raidu/BO-AAI/BlackOut-Uw-Alerts/evening_plays.py` (separate Discord-bot service, own git/Procfile). Output sink is **Discord embeds only** (`PLAYBOOK_CHANNEL_ID`, `evening_plays.py:828,1048`); it writes **nothing** to `nighthawk_editions`/`nighthawk_jobs` (grep for those tables across BO-AAI = zero hits). It is **exonerated** for #77 and is not a fallback for it. Do not "fix" #77 by pointing the UI at Python output — different sinks, different scoring/prompt logic.

### 2.2 The TS edition pipeline (end to end)

**TRIGGER:** Railway cron service `nighthawk-playbook` (`railway.nighthawk-playbook.toml`): `numReplicas=1`, `restartPolicyType=never`, `cronSchedule="*/15 21-23 * * 1-5"` (UTC). `startCommand` runs `scripts/hit-cron.mjs /api/cron/nighthawk-edition` → single GET with `Authorization: Bearer $CRON_SECRET`, 60s client abort (`scripts/hit-cron.mjs:28-49`).

**ROUTE:** `src/app/api/cron/nighthawk-edition/route.ts` — auth (`isCronAuthorized`, `:56`), DB guard (`:60`), `NIGHTHAWK_EDITION_ENABLED` (`:63`), `inEditionWindow` (17:30 ET + 120m catch-up, `:42-52`). `maxDuration=800` (`:19`); races `buildEveningEdition` against `BUILD_TIME_BUDGET_MS` (270s, `:29-32`); on budget hit returns **202 resume** after re-reading the job (`:107-149`); maps result → 200 / 202 / 500 + `logCronRun` (`:151-179`).

**BUILDER:** `src/lib/nighthawk/edition-builder.ts buildEveningEdition()` — a 6-stage, Postgres-checkpointed, resume-from-last-stage state machine keyed on `nighthawk_jobs(edition_for)`:
1. **stage_context** — `fetchMarketWideContext` (`market-wide.ts`, ~16 parallel UW+Polygon fetches, each `.catch(()=>[]/null)`).
2. **stage_candidates** — `extractCandidateTickers(ctx.stock_flows, ctx.hot_chains)` (`:159`); **both inputs derive solely from one `fetchMarketFlowAlertRows` call** (`market-wide.ts:219-248`). Empty → **terminal fail** (`:160-172`).
3. **stage_dossiers** — `fetchAllDossiers` batched 3-at-a-time, per-ticker staging rows, resume-aware via `fetchStagedDossierTickers` (`:185-222`). No scored dossiers → terminal fail (`:228-240`).
4. **stage_scoring** — `rankCandidates` (filters `trading_halt`/`fundamental_block`).
5. **stage_synthesis** — `generateEditionPlays` (`claude-edition.ts`, Sonnet temp:0, 4500 tok) → post-filters (stock-only, premium-cap, strike-OI validation) → `critiquePlays` (`play-critic.ts`, second Sonnet call). Either yielding 0 → terminal fail (`:318-357`).
6. **stage_publish** — `upsertNighthawkEdition` + `syncNighthawkPlayOutcomes` + mark `published` + `clearNighthawkStaging` (`:370-428`).

**READ PATH:** UI `NightHawkFeed.tsx` (SWR, 120s) → `fetchNightHawkEdition` → `GET /api/market/nighthawk/edition` → `fetchNighthawkEditionByDate ?? fetchLatestNighthawkEdition` (`route.ts:85`) → legacy engine fallback (`:92`) → `emptyEdition()` (`:99`). Pure DB reader, `no-store` — **cache-reader-compliant.**

**ADMIN:** "Run now" → `POST /api/admin/nighthawk/run` (`force:true`, `maxDuration=300`, **no** soft-deadline race).

### 2.3 Honest design verdict — **KEEP-AND-HARDEN**

**Strengths (genuinely well-judged):**
- Checkpoint-resume state machine is the right shape for a long, expensive batch — partial work is durable and a re-fire resumes (`edition-builder.ts:94-368`).
- The cron route's budget-race → 202-resume directly and correctly fixes the original #77 hard-kill (`route.ts:107-149`).
- Clean separation of concerns: context / candidates / dossiers / scoring / synthesis / critic / publish are distinct modules.
- Cache-reader rule correctly applied to per-user paths (hunt under `runWithUwHuntBudget`; play-explain single-flighted via `withServerCache`).
- Error serialization (`serializeBuildError`) and precise run-health mapping (in-progress → 202/skipped, failed → 500) were the right post-#77 instrumentation moves.

**Weaknesses (operational, not foundational):**
- **Pervasive fail-closed gates with no degrade path.** Five stages each hard-fail the *whole* edition with no row and no recap floor: empty candidates (`:160-172`), no scored dossiers (`:228-240`), no parseable Claude plays (`:318-332`), critic cuts all (`:343-357`), and (upstream) every play filtered out by stock-only/premium-cap/strike-OI validation (`claude-edition.ts:134-155`). Any one, on a thin night, reproduces the #77 symptom.
- **Single candidate feed.** `stock_flows` AND `hot_chains` come from one `fetchMarketFlowAlertRows` call — one provider, one point of failure, no Polygon/Massive fallback for the *candidate universe* (`market-wide.ts:219-248`).
- **No concurrency lock.** `buildEveningEdition` has no advisory lock (grep for `pg_advisory`/`withLock` in `src/lib/nighthawk` = nothing). Overlapping 15-min fires (a 202'd build keeps running in the background, `route.ts:112-115`) and admin Run-now (`force:true`) can both reach Stage 5 — double Claude spend, last-writer-wins re-publish, force-reset racing `clearNighthawkStaging`. This is the edition-specific slice of #70.
- **Non-transactional publish.** `upsertNighthawkEdition` → `syncNighthawkPlayOutcomes` → `job=published`/`clearStaging` are independent awaits (`:370-428`); a crash between writes leaves a live edition row with `job.status != published`, so the next fire re-publishes and a brief inconsistent read is possible.
- **LLM failures collapse to one `null`.** `anthropicText` returns `null` for timeout, spend-kill, and empty-completion alike (`anthropic.ts:354-357,387-391`), so `job.error` reads the generic "Claude returned no parseable plays" regardless. The 20s client default timeout (`anthropic.ts:206`) is applied to the largest call in the system — the 4500-tok synthesis with **no per-request override** (`claude-edition.ts:129`) — so a slow generation times out and retries up to 4× (~80s) before failing, burning the cron budget.
- **Critic fails open silently as "keep all."** A Sonnet outage/parse-fail returns plays unchanged (`play-critic.ts:97-104`), indistinguishable from "reviewed and approved" — `critic_applied` is derived from `notes.length` (`edition-builder.ts:407`), so the vetting gate can be bypassed with no signal. (A critic that *parses and cuts all* fails closed, `:343-357`.)

**Scalability:**
- Edition build is **uncapped** (not wrapped in `runWithUwHuntBudget` on any of cron/admin/worker paths) — correct, it runs at full data fidelity once nightly. The #99 per-hunt UW budget cannot starve it.
- The **per-user day-trade hunt** is the real scaling problem: ~6-7 per-candidate UW dossier datums are uncached (`fetchUwOiChange`/`IvTermStructure`/`RiskReversalSkew`/`InsiderTransactions`/`CongressUnusualTrades`/`InstitutionOwnership` call `uwGetSafe` with TTL 0, `unusual-whales.ts:933,949,1211,1219,1756,1805`), so a 12-token budget is exhausted after ~2 candidates and candidates 3-40 silently degrade to empty fallbacks. The cache-reader rule is only half-true on this path.

**Observability:**
- Good: `logCronRun` + `logNighthawkJob` + the admin overlay that reflects the latest job's status/stage/error (`admin-cron-health.ts:237-276`); per-fire 202 deliberately doesn't page (correct).
- Gap: **nothing watches the aggregate outcome.** If every 15-min fire returns "resume" all evening and the window closes with the job still `running`/`stage_synthesis`, no alert fires — the edition is silently absent. There is no "edition_for=tomorrow still unpublished at 20:00 ET" watchdog. The system can fail exactly the way #77 failed and page no one.
- Gap: no per-stage `duration_ms` in the job log, so "build keeps hitting budget" can't be attributed to prefetch vs synthesis vs critic.
- Gap: schedule under-covers the resume window in **EST** — `*/15 21-23 UTC` stops firing at 23:45 UTC (18:45 ET), ~45 min before the route's own 19:30 ET window end, shrinking the resume budget exactly when a long build needs it (`railway.nighthawk-playbook.toml:18` vs `route.ts:42-52`). The toml header comment claims "5:30-7:55 PM ET" coverage the schedule never reaches.
- Gap: the **UI collapses every non-success into one optimistic state.** `PlaybookBoard.tsx:56-102` keys only off SWR loading + `plays.length`; the public `NightHawkEdition` type (`types.ts:38-46`) has no `status`/`error`; `NightHawkFeed.tsx:14-16` discards the SWR `error`. A failed cron, a mid-build run, a 500, and a genuine pre-close wait all render identically as "publishes ~5:30 PM ET." The empty state lies — this is itself the user-facing half of #77.

---

## 3. PRIORITIZED FIX ROADMAP

### P0 — Get tonight's edition generating (and stop it going dark silently)

- **P0-A. Verify the shipped timeout fix is live.** Confirm `maxDuration=800` + budget/resume (`route.ts:19,29-32,107-149`) are deployed and that the Railway service hits the HTTP route, not the crashing tsx worker (`railway.nighthawk-playbook.toml:17`). Run the admin **"Run now"** (`POST /api/admin/nighthawk/run`, `force:true`) **during or just after RTH** to drive a first successful publish — once any edition publishes, GET's `fetchLatestNighthawkEdition` fallback (`route.ts:85`) ends the perpetual "being built" state.
- **P0-B. Make empty-candidates non-terminal — publish a recap-only edition.** `edition-builder.ts:160-172`: upsert `plays:[]` + real `market_recap` instead of `status:'failed'` with no row; adjust `available`/UI so the recap shows (`edition-builder.ts:473`).
- **P0-C. Stop empty-poison and off-hours starvation in the flow fetch.** `unusual-whales.ts:653-658` guard cache-set with `if (merged.length)`; `:669` serve last good cache off-hours regardless of `MARKET_FLOW_MAX_STALE_MS`.
- **P0-D. Add a window-close watchdog.** A ~20:00 ET cron (or extend `cron-staleness-watchdog`) that alerts when `edition_for = next-trading-day` is still unpublished after the evening window — the only guard against the silent "resume-forever, never publish" recurrence the per-fire 202 logic intentionally doesn't page on.
- **P0-E. Fix the lying UI empty state.** Thread job state into the read path: have `edition/route.ts` read `fetchNighthawkJob(editionFor)` and add a `status` to `NightHawkEdition` (`types.ts:38-46`); in `PlaybookBoard.tsx:56-102` render distinct **failed** ("didn't build — desk notified", no optimistic time), **generating** (progress/stage), and **pre-close** states; read the SWR `error` in `NightHawkFeed.tsx:14`.

### P1 — Durability, correctness, cost

- **P1-A. Add a Postgres advisory lock** (`pg_try_advisory_lock` keyed on `editionFor`) around `buildEveningEdition`; bail early if not acquired. Kills the overlapping-cron and cron-vs-admin double-spend / force-reset races (`edition-builder.ts:76-122`; #70 slice).
- **P1-B. Give the synthesis call an explicit timeout.** In `claude-edition.ts:129` pass `timeoutMs` ≈ 90-120s and `maxRetries:1` (one long attempt beats four 20s timeouts burning ~80s of the 270s budget); same for the critic (`play-critic.ts:96`).
- **P1-C. Add a quality floor — never fail to zero.** When post-validation/critic survivors `< N`, backfill from top-ranked scored candidates as explicitly-flagged "unvalidated contract / levels-only" plays rather than a hard failure (`claude-edition.ts:134-155`, `play-critic.ts:119`, `edition-builder.ts:318-357`). Make the strike-validation gate **symmetric** (currently fail-open on missing rows but fail-closed on parse failure, `claude-edition.ts:141-148`).
- **P1-D. Discriminate LLM failure modes.** Return a typed result from `anthropicText` (or propagate the APIError) so `job.error` records timeout vs spend-cap vs parse vs empty (`anthropic.ts:354-391`). Surface a distinct signal when the spend kill-switch / its Redis fail-closed backstop trips (`anthropic.ts:310-323`) so a Redis blip in the 5:30pm window isn't misread as a content failure.
- **P1-E. Make the critic gate observable.** Distinguish "critic ran, kept all" from "critic unavailable" in `meta`/job log (`play-critic.ts:97-104`, `edition-builder.ts:407`); add a floor so one over-skeptical-but-parseable critic response can't zero an otherwise valid edition.
- **P1-F. Fix the per-user hunt budget starvation.** Either raise `NH_HUNT_UW_BUDGET` to cover real cold calls, cap hunt candidates well below 40 (dossier top ~8-10), or add Redis L2 caching to the six uncached UW dossier datums (`dossier.ts:262-278`). Soften the all-or-nothing day-trade filters ("keep + flag" for ambiguous direction; reconsider rejecting no-expiry plays under `maxDte<=1`, `day-trade-filters.ts:44-101`).
- **P1-G. Widen the cron schedule for EST.** Extend past 23:59 UTC into hour 0 (e.g. `*/15 21-23 * * 1-5` **plus** `*/15 0 * * 2-6`) so the full 17:30-19:30 ET resume window is covered in both DST states; fix the toml header comment to match (`railway.nighthawk-playbook.toml:10-11,18`).
- **P1-H. Confirm ops plumbing in the Railway console** (only confirmable there, per the dashboard-override caveat): the `nighthawk-playbook` service exists, has Config-as-code → `railway.nighthawk-playbook.toml`, has **no** conflicting UI-set `cronSchedule`, shares `CRON_SECRET` with blackout-web, and `DISCORD_OPS_WEBHOOK_URL` is set so the watchdog can actually deliver alerts.

### P2 — Hygiene, instrumentation, structural cleanup

- **P2-A. Resolve the two-entrypoint ambiguity.** `package.json:20` `nighthawk:run` and route/builder comments point operators at `scripts/nighthawk-worker.ts`, which the toml says **crashes** on `server-only` (`railway.nighthawk-playbook.toml:5-11`). Either fix the worker (lazy-import the server-only chain) or delete it + the package script + every "run nighthawk:run" note. One blessed build path.
- **P2-B. Wrap stage-6 publish atomically** so the edition row and `job=published` commit together (`edition-builder.ts:370-428`).
- **P2-C. Emit per-stage `duration_ms`** into `logNighthawkJob`/cron meta so a budget-overrun is attributable to prefetch vs synthesis vs critic.
- **P2-D. Add a pre-publish minimum-data-quality assertion** (e.g. non-null tide/spx_bars/N scored dossiers) so a broadly-degraded day fails loudly instead of publishing a thin edition the `.catch(()=>[])` guards let through looking healthy (`market-wide.ts:217-236`).
- **P2-E. Instrument the synthesis erosion funnel** (parsed → stock-only → premium-cap → strike-validated → critic-kept) into job meta; today these only `console.warn` (`claude-edition.ts:149-162`).
- **P2-F. Add a regression guard** asserting the edition's halt check is invoked with `failClosedOnStale:false` (the single thing standing between current code and overnight-empty editions, `dossier.ts:308`) — e.g. a CI grep that fails if any nighthawk file calls `shouldBlockForTradingHalt` without it. Implement #105's "halts fail-open" as a first-class env switch.
- **P2-G. Reconcile candidate-vs-dossier premium floors** (100k selection vs 50k dossier re-pull, `dossier.ts:224`) and stop double-counting alerts in both premium and hot-chain pools (`candidates.ts:69-98`).
- **P2-H. Replace the module-global `_defaultBuildCache` reset pattern** with the per-call cache the `fetchAllDossiers` path already uses, before multi-user concurrency makes the latent cross-build contamination real (`dossier.ts:83-131`).
- **P2-I. Give admin Run-now the same soft-deadline race** the cron route has, or lower its per-call work, so a 300s overrun returns a clean 202 instead of a host hard-kill (`admin/nighthawk/run/route.ts`).
- **P2-J. Fix doc/registry drift:** `cron-registry.ts:57-65` labels nighthawk-playbook `kind:'worker'` with no path (it's an HTTP route) and the `schedule_label` says "5:30 PM ET" vs the 21:00-23:00 UTC toml; demote `data-sources.ts` to docs/ or generate it from real call sites.
- **P2-K. Decide the Python Playbook's fate explicitly:** keep it as the documented Discord-only product, or retire it and have Discord consume the TS `nighthawk_editions` table to kill prompt/scoring drift. Add a DB-persisted last-run guard against its in-process scheduler double-fire/skip (`evening_plays.py:88`).
- **P2-L. Land #103** (Anthropic prompt caching + Message Batches) on `generateEditionPlays` — synthesis is the dominant cost/time sink and the exact place the original timeout occurred.

---

## Appendix — Disagreements reconciled

| Claim | Dimension audits | Verdicts | This report (verified) |
|---|---|---|---|
| #77 root cause | Off-hours empty UW flow → terminal fail | Synthesis-stage timeout/hard-kill (documented) | **Verdicts.** Confirmed at `route.ts:12-18,101-106`. Empty-flow is a real but conditional/incident secondary. |
| Post-close flow-alerts returns `[]` | Yes (routine) | No — endpoint not date-windowed | **Verdicts.** `market-wide.ts:220`, no date param; returns the day's tape. |
| 30-min stale guard fail-closes routinely | Yes | No — only in the `catch`/error path | **Verdicts.** `unusual-whales.ts:660-678` is inside `catch`. |
| GET → bare `emptyEdition()` | Yes | No — `?? fetchLatestNighthawkEdition()` first | **Verdicts.** `edition/route.ts:85`. Perpetual placeholder ⇒ no edition ever published. |
| Halt fail-closed-on-stale | Live cause (some) / fixed (others) | Already fixed | **Fixed.** `dossier.ts:304-308`. |
| Python Playbook involvement | Separate, exonerated | n/a | **Exonerated.** Discord-only sink, never writes `nighthawk_editions`. |
| Empty merged result cached as fresh | Real bug | Real bug | **Confirmed.** `unusual-whales.ts:653-658`, no length guard (P0-C). |
