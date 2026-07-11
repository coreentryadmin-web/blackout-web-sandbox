# SPX System — Deep Sweep (2026-07-11)

**Scope:** the full SPX Slayer system beyond the playbook layer already covered in `PLAYBOOK-BUG-AUDIT-2026-07-11.md` — market-data assembly (`spx-desk.ts`, providers), technicals/MTF, outcome grading & persistence, member-facing display, the Claude/BIE approval gate, BIE narrative integration, cron scheduling, DB schema/retention, and a security sweep of the newer admin surfaces. Every file here was either never reviewed in the prior five rounds, or only grepped for a specific field.

**Method:** 10 parallel agents, each doing a genuine first full read (not sampling) of its assigned files. Read-only — no files edited, no fixes applied. This document is the handoff for Cursor to act on.

**Headline:** one CRITICAL, structural bug that's been silently disabling breakout-continuation logic system-wide, likely since before this review series started. Everything else is real but more contained.

---

## Critical

### 1. `hod_break`/`lod_break` can never fire during RTH — breakout playbooks/gates are structurally dead

**Files:** `src/features/spx/lib/spx-play-technicals.ts:331-332`, `src/lib/providers/spx-session.ts:148-159` (`widenSessionExtremesWithSpot`), `src/features/spx/lib/spx-desk.ts:1595`, `src/features/spx/lib/spx-desk-merge.ts:339-341`.

`hod_break: ctx.hod != null && price > ctx.hod + buf`. But `ctx.hod` is fed from `merged.hod`, which has already been widened via `hod = Math.max(hod, price)` against the **same live price** used in the comparison — this widening happens **twice** (once in `spx-desk.ts`, again in `spx-desk-merge.ts`) before `buildPlayTechnicals` ever sees it. Since `ctx.hod ≥ price` by construction, `price > ctx.hod + buf` is mathematically unsatisfiable for any non-negative buffer. Same for `lod_break` in the opposite direction.

**Failure scenario:** SPX prints a genuine new session high on real breakout volume. `hod_break` still reads `false`. Every consumer gated on it silently breaks: `spx-desk.ts:649-650` (breakout-continuation trigger), `:382` (`breakingOut` flag), `:833,965,970` (`noBreakout` guards), and `playbook-shadow-matcher.ts:285-286` (PB-03's pre-OR fallback branch). PB-03's primary path (OR-based) is unaffected; `pdh_break`/`pdl_break` (prior-day levels, never widened) are also unaffected — but every *intraday* HOD/LOD breakout signal in the system has been non-functional. This has the widest and most severe blast radius of any bug found across all six review rounds — it silently disables an entire signal category rather than producing a wrong value.

**Fix direction:** compute `hod_break`/`lod_break` against the pre-widen session extreme (or the prior bar's high/low), not the spot-inclusive one that was widened specifically for a different purpose (structure-level display).

**Status:** FIXED PR `cursor/hod-break-fix-261c` — `sessionBreakoutExtremesFromBars` in `spx-play-technicals.ts` (bar-derived extremes, excludes forming last bar).

---

## High

### 2. `spx-desk.ts` — GEX value and its label/staleness badge can come from different sources
`spx-desk.ts:1289-1303`. When `engineIntelOverlayEnabled()` is on, `gammaFlip`/`gexNet`/`gexKing`/`maxPain` prefer the external "engine intel" service (`/spx/state`) over the canonical heatmap-derived values — but `gammaRegimeLabel` and `gex_stale`/`gex_age_ms` are always taken from the canonical source, never recomputed against whatever the intel overlay actually returned. A member can see a GEX/flip number from one data source, a regime label computed against a *different* flip, and a freshness badge describing neither. Also contradicts the file's own comment ("Canonical matrix is the sole GEX source") which is now stale relative to the code.

### 3. `spx-desk.ts` — missing `.catch()` on the most foundational fetches, inconsistent with the file's own resilience pattern
`spx-desk.ts:1149-1176` (and the two sibling entry points `buildSpxDeskPulse`, `buildSpxDeskFlow`). `fetchIndexSnapshots`/`fetchIndexDailyBars` have no `.catch()`, while `fetchIndexMinuteBars` right next to them does. This file otherwise invests heavily in graceful degradation (8s GEX timeout + sticky fallback, staleness tracking) — but a single transient Polygon 5xx on these two calls throws all the way up and hard-fails the entire desk instead of returning the `empty` payload the function already has ready for exactly this case.

### 4. BIE's narrative brief is playbook-blind — can show contradictory theses to the same member
`src/lib/bie/spx-desk-brief.ts:390-483`. `bias`, `headlineVerb()`, and the setup text are computed exclusively from `confluence.*`; the playbook verdict only appears as an isolated footer line (`playbookLine`, lines 490-498), never cross-checked. The codebase already has conflict-detection machinery for exactly this purpose — `liveEngineConflict()` and `crossToolAlignment()` (`spx-desk-synthesis.ts:85-129`) check confluence bias against the open-play engine, Night Hawk, and Lotto — but the playbook engine was never added to it, and the API route that assembles the response (`src/app/api/market/spx/commentary/route.ts:105-122`) discards `primary.direction` even though it's in scope. **Concrete scenario:** confluence reads bearish (headline "SHORT...", full ALIGNMENT block) while PB-01 is simultaneously armed/fired long — the brief prints both, unreconciled, in the same response. Worse: the Largo chat path (`src/lib/bie/composers.ts:124-130`) doesn't even populate the playbook field — total silence there, not even the degraded footnote.

### 5. Unguarded playbook fetch can 502 the shared commentary cache for every member on one bad tick
`src/app/api/market/spx/commentary/route.ts:105-122`. Every other cross-signal fetch in this route (openPlay, lotto, powerHour, outcomes, nighthawk, positioning, heatmap) is wrapped in `.catch(() => null)`. The playbook-shadow fetch is not. This route serves a single 5-minute cache shared across every connected member — one exception in the matcher takes down the confluence-only brief platform-wide instead of degrading to "playbook data unavailable."

### 6. `closeOpenPlay`'s DB-transaction branch bypasses the optimistic-concurrency pattern used everywhere else in the same file
`src/features/spx/lib/spx-play-store.ts:392-463`. `savePlaySessionMeta` (used by `recordBuy`, and by this same function's in-memory fallback branch) has a proper read-merge-version-retry loop, labeled `BUG-07 fix`. The DB-transaction close path doesn't use it: session-meta is read once *before* the transaction opens (line 393), the delta is computed from that stale snapshot, and written directly via `setMetaFn(...)` — skipping the pattern entirely. It also never checks the affected-row count from `closeOpenSpxPlayRow` (line 434, awaited and discarded), unlike the sibling `recordPlayClose` which does check. **Scenario:** two near-simultaneous close triggers (a stop-check and a target-hit-check racing on the same play) can both read the same stale meta, both write, and the second write silently clobbers the first's `session_losses_today`/`last_stop_at` increment — the exact kind of lost-update bug the BUG-07 pattern exists to prevent, on the single highest-stakes write path in the whole persistence layer.

### 7. The "Claude approval gate" fails open, by default, for the exact thing it exists to do
`src/features/spx/lib/spx-play-claude.ts` (note: despite its name and every reference to it elsewhere as "the Claude gate," this file makes **zero** calls to Anthropic — it's a mechanical rule-check plus a Voyage-embeddings cosine-similarity search against historical trades; confirmed via its own docstring). Whether the BIE precedent check runs at all is gated by `SPX_CLAUDE_GATE`, which defaults **unset**. With the flag unset (today's default): every failure mode (Voyage/DB unavailable, search error, thin corpus, inconclusive precedents) silently falls back to a mechanical-only verdict with no VETO and no distinguishing log — not a blind fail-open (gates/grade/confirmations still apply), but a fail-open specifically on the second-opinion precedent check this file's entire stated purpose is to add. A 3-day Voyage outage would be invisible.

### 8. Audit trail gap — fail-closed VETOs are never logged
`spx-play-claude.ts:318,347` are the *only* call sites of `logPlayVerdict()`. Every `failClosedVerdict()` return and every mechanical-fallback path (roughly 8 of ~10 total return branches) writes nothing to `alert_audit_log`. This directly contradicts the existing description in `docs/audit/FINDINGS.md:3023` ("called for both the grounded-approved verdict and the grounding-failure-forced mechanical fallback") — either that description was already wrong or the code has regressed since. Either way: the exact scenario that most needs an audit trail (the gate silently degraded for days) currently produces zero evidence of it happening.

### 9. Three actively-growing playbook tables have no retention policy at all
`src/lib/db.ts` (`spx_playbook_instances`, `spx_playbook_instance_events`, `spx_playbook_shadow_observations`) — confirmed absent from `src/lib/db-cleanup-targets.ts` and the `db-cleanup` cron's task list, while every sibling telemetry table (`spx_engine_snapshots`, `spx_confluence_shadow_observations`, `spx_signal_observations`, etc.) is covered. `spx_playbook_instance_events` is the worst case: pure append-only, one row per FSM transition, no upsert ceiling, currently written from both the 5-minute cron *and* unthrottled live member polling. These tables were evidently added after the cleanup cron was built and never back-filled into it.

---

## Medium

10. **`classifyOutcome` has three inconsistent breakeven definitions across exit-action branches** (`spx-play-outcomes.ts:185-206`) — THETA/SESSION/THESIS treat exactly `pnl_pts===0` as breakeven; TRAIL treats the whole `[0,∞)` band as a win; TARGET/UNKNOWN treat `(-1,2)` as breakeven. Worse: `exit_action==="TARGET"` short-circuits to "win" unconditionally regardless of actual P&L sign, contradicting its own comment. Identical 0-pt scratch exits get bucketed as win vs. breakeven purely based on which exit label the engine happened to assign — this skews the public win-rate stat.
11. **STOP exits are unconditionally classified "loss"** even when trailed to breakeven — TRAIL has an explicit breakeven-lock guard in its own comment; STOP has no equivalent.
12. **`updateOpenPlay` has zero optimistic-concurrency protection** (`spx-play-store.ts:372-382`) — MFE/MAE high-water-mark patches can race and silently lose the higher value, corrupting stats the promotion pipeline consumes.
13. **EMA duplication between `ma-math.ts` and `spx-play-technicals.ts` is still unfixed** — flagged in a prior review round, confirmed still present (not byte-identical, algorithmically identical, unimported). A third, deliberately-independent copy in `desk-verifier.ts` is correct by design and should not be touched.
14. **NaN can silently poison the gamma-flip calculation** (`gamma-desk.ts:26-42`, `87-124`) — `analyzeStrikeGexRows` validates `strike` for finiteness but not `call_gamma_oi`/`put_gamma_oi`; one malformed strike can make the cumulative-sum flip-detection read a fabricated (but plausible-looking) flip level instead of erroring.
15. **`spx-session.ts`'s prior-day OHLC fallback can regress to the exact bug it says it already fixed** (`spx-session.ts:114`) — `bars.every(b => b.t != null)` is all-or-nothing; one bad timestamp among ~200 daily bars silently degrades the entire computation to the naive `bars[length-2]` approach the adjacent comment explicitly documents as previously corrupting every derived level off-hours.
16. **Claude-gate verdict cache key omits `confirmations.passed`** (`spx-play-claude.ts:41-45`) — a stale approved verdict (up to 60s / 1.5pts old) can be served after confirmations have since failed, since the cache is checked before confirmations are consulted.
17. **~~From the fifth-pass playbook review~~ FIXED #100:** ~~the promotion pipeline's data-quality check only covers `desk_stale`/VWAP~~ — `playbookDataQualityBlockReason` is wired in `playbook-promotion-sample.ts` as of PR #100.
18. **No locking or uniqueness constraint on `spx_playbook_instance_events` inserts** across the cron path and the live member-polling path — unlike the lotto/power-hour path, which explicitly uses an advisory lock. Concurrent writers can produce duplicate event rows feeding the promotion-evidence pipeline.
19. **Missing index for `spx_playbook_shadow_observations`'s actual read pattern** — `fetchPlaybookShadowObservationsForSession` filters by `session_date` with no index leading on that column; will worsen as the table's unbounded growth (finding #9) continues.
20. **Untyped external "engine intel" data trusted via bare `as` casts with no runtime validation** (`spx-desk.ts:1284-1410`) — compounds finding #2; a malformed field from the external service flows straight into member-facing numeric comparisons unchecked.
21. **Unrounded floats reach `spx-desk.ts`'s payload directly** — `gex_net`, `max_pain`, `price`, `vwap`, EMAs/SMAs have no rounding anywhere in this file, unlike the sibling `gamma-desk.ts` which does round its outputs. This is the file the CLAUDE.md's own "round at the data layer" note should apply to most, and doesn't.
22. **Confirmed unrounded float reaching the UI**: `SpxSniperHeader.tsx:107`'s IV Rank stat renders via bare `String()`, bypassing the `fmtPrice`/rounding convention every other stat pill in the same row uses.
23. **`useMergedDesk.ts` completely swallows SWR fetch errors** — none of its four hooks surface `error`, one has an explicit no-op `onError`, and `keepPreviousData: true` means a persistent backend failure renders as indefinitely-fresh-looking stale data with the "LIVE" indicator still active and zero error state anywhere in the dashboard.
24. **`spx-play-technicals.ts`'s bar-normalization filter validates only `close`, not `high`/`low`** — one malformed bar with a NaN high/low but a valid close silently poisons `or_high`, `rolling_30m_high/low`, and every downstream comparison for the rest of the session, with no error surfaced.
25. **Technicals stale-price cache can serve a `price` field up to 30s/1.5pts stale** relative to the fresh price the caller actually passed in (`spx-play-technicals.ts:280-284`) — a real divergence source between `technicals.price` and `desk.price` that downstream consumers implicitly assume are identical.
26. **`SPX_CLAUDE_DAILY_MAX_CALLS` is dead code** — the config knob exists and implies a rate limit on the BIE precedent search, but is never referenced anywhere.
27. **Known residual risk, reconfirmed**: the fuzzy join in `alert-outcome-sync.ts` (direction + 0.01-tolerance price + 30-min window, earliest-match-wins) can still pick the wrong trade if two same-direction, similar-price plays open within the same window — unchanged from when this was first documented, still worth a note.

---

## Low / hygiene

28. `topGexWalls`'s `limit` contract can be violated for small limit values (`gamma-desk.ts:174-221`) — no live call site uses a small enough limit to trigger it today.
29. `rsi()` returns 100 (max overbought) instead of a neutral value on a completely flat price window.
30. `strikeTotalsToLevels` validates `strike` for finiteness but not `net` — asymmetric guard, same NaN-propagation shape as finding #14 in a different function.
31. Fragile positional contract in `spx-desk.ts` for draining pooled UW REST results (push-order must exactly match extraction-order; TypeScript won't catch a future desync).
32. `buildSpxDeskFlow` can compute GEX/regime against `spot=0` when the snapshot fetch fails but stale flow data still exists — correct consumers gate on `available: false`, but the numeric fields themselves are misleading if read directly.
33. `spx-invalidation.ts` has no staleness guard, unlike its sibling `spx-desk-brief.ts` which does check `gex_stale`/`feed_stalled`.
34. Stale doc comment: `spx-signal-observe`'s route docblock says "every minute during RTH," actual schedule is every 5 minutes (previously flagged, still unreconciled).
35. Three SPX crons (`spx-evaluate`, `spx-issues-sync`, `spx-signal-observe`) share an identical `*/5 11-21 * * 1-5` schedule, concentrating simultaneous DB round-trips at the same minute — no demonstrated harm today, worth staggering defensively as load grows.
36. `fetchPlaybookPromotionEvidenceRows` has no `LIMIT`/max-lookback on its `since` parameter — an admin-gated but genuinely unbounded query.
37. No format validation on the `session`/`since` query params on the two new admin routes before DB use — not exploitable (fully parameterized), just returns a generic 502 instead of a clean 400 on malformed input.
38. `spx_play_outcomes.playbook_instance_id`/`spx_playbook_instance_events.instance_id` are string-keyed references to `spx_playbook_instances.instance_id` with zero DB-level FK enforcement — consistency depends entirely on application code across cron, member-read, and admin-route write paths.

---

## Security — explicit clean bill

Full adversarial pass on the two new admin routes (`fsm-today`, `promotion-report`), their underlying DB query functions, `admin-playbook-promotion.ts`, `playbook-promotion-sample.ts`, and the rewritten `playbook-evidence-report.mjs`:

- **No SQL injection found anywhere.** Every query is parameterized; traced both user-controlled query params (`session`, `since`) all the way to their terminal bound-parameter usage.
- **Auth-check ordering is correct on both routes** — `requireAdminApi()` runs first, unconditionally, before any DB call or param parsing.
- **No secret leakage found** in any response payload, error message, or log path (Discord webhook URL, DB credentials, connection strings all checked).
- Only finding: #36 above (unbounded query, low severity, admin-gated).

---

## Suggested priority order for Cursor

1. **Fix #1 (`hod_break`/`lod_break`) immediately** — this is the highest-blast-radius bug found in the entire review series; it silently disables breakout-continuation logic system-wide and has likely been broken for a long time without anyone noticing because nothing throws.
2. **#4 and #5** (BIE playbook-blindness + unguarded fetch) — both are member-visible correctness/availability issues with a clear, contained fix (thread `primary.direction` through into the existing `crossToolAlignment()` machinery; add the missing `.catch()`).
3. **#6** (`closeOpenPlay` concurrency gap) — apply the existing `BUG-07`/`savePlaySessionMeta` pattern to the one place in the file that's missing it.
4. **#7/#8** (Claude-gate fail-open default + missing audit trail) — decide deliberately whether `SPX_CLAUDE_GATE` should default on, and wire `logPlayVerdict()` into the fail-closed/fallback paths regardless of that decision, since the audit-trail gap is valuable independent of the default.
5. **#9** (retention) — add the three missing tables to `db-cleanup-targets.ts`; small, mechanical, prevents a slow-burn ops problem.
6. Everything else in Medium/Low is real but not urgent — good material for a cleanup sprint, not a stop-the-line.

None of this overturns the standing verdict that staging is correctly positioned as research, not trusted capital deployment — but #1 in particular means some of the "evidence" already being gathered from breakout-dependent playbooks (PB-03's fallback path, breakout-continuation triggers referenced from `spx-desk.ts`) has been collected against a signal that could never actually fire, which is worth factoring into how much that evidence should currently be trusted.
