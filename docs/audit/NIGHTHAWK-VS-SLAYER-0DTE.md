# Night Hawk 0DTE vs SPX Slayer 0DTE — deep comparison, live-data audit, and unification proposal

**Date:** 2026-07-13 · **Branch:** `fix/nighthawk-0dte` (analysis + surgical fixes only; migration NOT implemented)
**Directive:** compare both systems' 0DTE logic end-to-end, analyze the real track record (DB/Redis/live APIs),
fix what is clearly broken in Night Hawk 0DTE, and propose how "all 0DTE plays live in Night Hawk 0DTE."
**Data provenance:** every number below was pulled 2026-07-13 20:17 UTC from authed **staging** APIs
(temp Cognito admin user, deleted after the run): `/api/track-record`, `/api/track-record/plays`,
`/api/admin/nighthawk/analytics?window=30`, `/api/market/nighthawk/{record,edition}`, `/api/nighthawk/play-status`,
`/api/admin/zerodte/health`, `/api/market/zerodte/board`, `/api/admin/analytics/spx`, `/api/admin/signal-analytics`,
`/api/admin/playbook/promotion-report` — plus direct Polygon spot checks. Raw JSON captures were reviewed in-session.

---

## 0. Executive summary

There are not two 0DTE systems — there are **four surfaces** producing or claiming 0DTE plays, with three
different accountability standards:

| Surface | What it is | 0DTE? | Graded? | Persistence |
| --- | --- | --- | --- | --- |
| **SPX Slayer play engine** | Single-instrument (SPX) intraday engine: confluence score + 20+ entry gates + playbook FSM + trade governor | Always (expiry = today, `spx-play-options.ts:151`) | Yes — `spx_play_outcomes`, every open play closes graded | Postgres |
| **0DTE Command** (`/grid`, `src/lib/zerodte/*`) | Always-on multi-ticker flow scanner (UW tape → 4 evidence gates → contract plan) | Yes (0–1 DTE, `max_dte:1`) | Yes — `zerodte_setup_log` plan + direction grades | Postgres |
| **Night Hawk edition** | Evening LLM/deterministic playbook, ≤5 stock plays for the NEXT session | No (swing/overnight; no DTE constraint on edition contracts) | Yes — `nighthawk_play_outcomes` (stock move, not option P&L) | Postgres + Redis confirm blob |
| **Night Hawk Day-Trade Agent** (hunt `mode:"day"`) | On-demand intraday hunt, clamped 0–1 DTE + SPX-alignment filter | Yes | **No — emits transient signals, writes nothing, grades nothing** | none |

Headline conclusions:

1. **SPX Slayer's 0DTE machinery is an order of magnitude more disciplined than anything in the Night Hawk
   namespace** — regime router, 20+ entry gates, trade governor (entry/loss caps, cooldowns, re-entry locks),
   delta-band strike selection, VIX-indexed exits, force-exit clock, and a promotion pipeline with statistical
   gates. Night Hawk's only *graded* 0DTE surface (0DTE Command) has 4 evidence gates, a fixed −50 %/+100 %/15:30
   plan, and zero portfolio-level risk management.
2. **Live outcome quality reflects exactly that gap.** SPX Slayer: 25 closed plays / 14.1 days, 48 % win rate,
   controlled losses (avg MAE ~2 pts, worst −13.6 pts, force-exit discipline). 0DTE Command on 2026-07-13 alone:
   **8 plays, 1 winner (+76.6 %), 7 losers clustered at ~−50 %** (the plan's stop), five of them longs flagged
   9:50–10:20 ET on a red tape. The scanner is a *flow follower* with no market-regime gate: on a trend-down day
   it bought every call-sweep cluster at the open and donated seven stops.
3. **Night Hawk edition ≠ 0DTE and its record is thin and geometry-noisy:** 14 resolved plays in 30 days
   (42.9 % win rate, profit factor 4.2 on stock-move math, not option P&L), published editions carry
   plays with stops *inside* the entry band (AMD 2026-07-07 A+: entry 550–555, stop 550.88 → next close 516)
   and targets equal to the band top (AMAT 2026-06-29: entry 657.5–662.5, target 662.5, graded `stop` while the
   stock closed +5 % at 694.64). The critic/geometry gate validates against the *midpoint* only.
4. **Found + fixed on this branch (clear bugs, tests added):** (a) index-root 0DTE plays (SPXW/SPX/NDX) could
   never receive a direction grade — Polygon returns an empty (not failed) result for those roots, so rows were
   stamped `graded` with permanent nulls, and their intraday reads silently degraded; (b) the member-visible
   `nighthawk_echo` on the 0DTE board serialized pg DATE columns as
   `"Fri Jul 10 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"` (a recurrence of the #77 Bug 1 class).
5. **Recommendation in one line:** keep SPX Slayer's engine as the *execution brain*, make "Night Hawk 0DTE"
   the *member-facing umbrella* fed by it — do NOT port Slayer's logic into the Night Hawk codebase, and retire
   the ungraded Day-Trade Agent lane rather than migrate it.

---

## 1. System maps (code-verified)

### 1.1 SPX Slayer 0DTE (single instrument, always 0DTE)

- **Driver:** cron `spx-evaluate` → `runSpxEvaluator` → `evaluateSpxPlay` (`src/features/spx/lib/spx-play-engine.ts:1471`),
  serialized cluster-wide by Postgres advisory lock `872341`. Member reads are read-only snapshots.
- **Signal inputs** (`spx-desk.ts`, 3 cache lanes ~10 s): Polygon GEX heatmap → gamma desk (`gamma-desk.ts`: net GEX,
  king node, `computeGammaFlip`, regime with 2-pt hysteresis, two-sided walls), UW 0DTE flow/per-expiry/net-flow,
  market tide, max pain, NOPE, dark pool, greek exposure, mag7 greek flow, IV rank, macro indicators, HELIX sweeps,
  trading halts, macro events, VWAP/PDH/PDL/EMA technicals — folded into `computeSpxConfluence` (`spx-signals.ts:253`)
  → score/grade/direction/weighted-conflicts. A Night Hawk confluence bonus (±3) is already wired in
  (`spx-play-engine.ts:157` — the two systems already talk).
- **Entry gates** (`spx-play-gates.ts:158`, all must clear): market open; trade governor verdict; playbook live-gate
  (fired + allowlisted primary playbook); halt + halt-channel staleness; GEX map present; desk staleness ≤ 90 s;
  weighted-conflict cap (≥4 blocks); grade ≥ B; macro hard-block windows (CPI/FOMC/NFP…, Fed 14:00 ±15 m);
  no BUY before 9:50 (9:30 + 20 m opening range) or after 15:30; cold-BUY floor 68 + grade A; score floors
  (watch 38 / starter 48 / full 52); flow staleness ≤ 5 m; R:R ≥ 1.2; ≥3 agreeing factors; ≥5 confirmations.
- **Playbooks:** 14 registered setups (PB-01…14) with regime router (`playbook-regime-router.ts` — opening_drive
  forced 9:30–10:30, eligibility matrix per regime bucket), execution-mode ladder shadow→paper→limited_live→production,
  and a promotion pipeline with hard statistical gates (30 triggers / 20 sim trades / 8 sessions for research;
  50 closed / 15 sessions / walk-forward positive windows for staging; 75 closed for limited-live).
- **Strike/expiry:** always `todayEtYmd()` expiry; chain queried under `I:SPX` (the only root Polygon serves with
  greeks); delta-band by grade (A+ 0.45–0.55, A 0.35–0.45, ≤B 0.25–0.35); spread ≤ 18 % (20 % first 30 min);
  OI/vol floor 25; graceful fallback to index-plan ticket.
- **Risk mgmt:** trade governor — 5 entries/session, halt after 3 losses, 20 m same-direction re-entry lock after a
  loss, 15 m post-stop cooldown, 10 m buy cooldown, VIX >32 halt / >28 size-down, per-playbook trigger cap 3;
  exits — VIX-indexed targets (12/14/18 pts) and trims (10/12/14 pts @ 70 % progress), trailing stop
  (breakeven @ 8 pts MFE, trail @ 15), thesis-break, **force-exit 15:45 ET**; stale-desk suppresses price-driven exits.
- **Persistence:** `spx_open_play` (one open play per session, partial unique index), `spx_play_outcomes`
  (win/loss/breakeven, pnl_pts, MFE/MAE, entry_path, exit_action), shadow observations + playbook FSM instance/event
  tables, session meta in `platform_meta` with optimistic concurrency.

### 1.2 Night Hawk (edition + hunt + day-trade agent)

- **Edition (the product core):** cron 17:30 ET → staged, checkpoint-resumable builder (`edition-builder.ts:317`):
  market context → candidate extraction (UW flow leaders + unusualness, 28+12 slots, cap 40) → dossiers →
  deterministic scorer (`scorer.ts:733`: flow/tech/positioning/news/smart-money/fundamental/catalyst/SI sub-scores,
  regime multiplier, conviction A+ ≥70 / A ≥55 / B ≥40) → LLM synthesis (`claude-edition.ts`, temp 0) *or*
  deterministic fallback → critic + grounding + geometry + sector cap (≤2/sector) + premium cap ($20/share) →
  publish ≤5 plays to `nighthawk_editions`. Morning confirm 9:15 ET writes CONFIRMED/DEGRADED/INVALIDATED to Redis
  `nh:play-status:{date}`. Outcomes resolve 16:30 ET into `nighthawk_play_outcomes` — **stock-move grading from the
  entry-band midpoint** with a fillability guard (`unfilled` excluded) and both-sides-hit tiebreak.
- **0DTE Command** (`src/lib/zerodte/*` — branded in-app, *not* wired into the edition): grid-warm cron ~2 min through
  RTH + member polls (5 s collapse). Pipeline: `fetchRecentFlows({since_hours:7, min_premium:150k, max_dte:1})` →
  `deriveZeroDteSetups` (4 gates: gross ≥ $750k, at-ask aggression ≥ 0.30, side dominance ≥ 0.65, top strike not
  >2 % ITM; fail-closed on missing underlying) → top-5 get the Night Hawk dossier + intraday edge layer (own-name
  VWAP/opening-range/5-m trend, SPY market bias, time-of-day factor — **score adjustments only, never blocks**) →
  contract plan from real fills/quotes (chase-guard +35 %, illiquid >15 % spread) → ledger upsert + audit row.
  Fixed risk rules: stop −50 %, trim +100 %, no new plays ≥15:00, hard exit 15:30. Grading: option's own minute bars
  (`gradePlanFromBars` — stop-before-target within a bar, conservative) + underlying close direction grade.
  Dedupes against the latest Night Hawk edition (a published ticker is excluded from the board).
- **Day-Trade Agent** (`agents/day-trade-agent.ts`): user-triggered hunt `mode:"day"`, DTE clamped 0–1, drops plays
  contradicting SPX desk bias, phases CANDIDATE/WATCH/ACTIONABLE/EXPIRED — **but writes no ledger, grades nothing**.

### 1.3 Where they already touch

- Slayer takes a ±3 Night Hawk confluence bonus; the 0DTE Command board annotates rows with `nighthawk_echo`
  (the last NH edition's take on the same ticker); 0DTE Command excludes NH-published tickers; both NH lanes and
  0DTE Command share the dossier/session/constants modules. **One brain in embryo — but three risk cultures.**

---

## 2. What the live data says (staging, 2026-07-13)

### 2.1 SPX Slayer — 25 closed plays, 2026-06-29 → 2026-07-10 (14.1 days)

- **48 % win rate** (12W/13L), cold_buy 50 % (10), watch_promote 47 % (15). Avg MFE 2.3 pts, avg MAE ~2 pts.
- Exit discipline is real: losses cluster at −1…−7 pts with three STOP exits (worst −13.6); wins +2…+11.8.
- **Every one of the 25 plays is `direction: long`.** Two weeks of one-sided output is a monoculture flag —
  either the regime router genuinely never qualified a short in a rising tape, or short-side playbooks
  (PB-02 class) never reach executable. Signal-accuracy telemetry: 589 observations / 41.65 % overall accuracy
  (7/07–7/13) — the gate stack, not raw signal accuracy, is what makes the closed-ledger 48 % possible.
- Playbook promotion report: **every playbook still `insufficient`** (49 OOS instance rows since 7/10, 0 closed
  playbook trades) — the promotion pipeline is armed but statistically empty; live entries ride the legacy
  confluence path + staging lab.

### 2.2 0DTE Command — session of 2026-07-13 (full ledger)

| Ticker | Dir | Flagged (ET) | Entry prem | Last mark | Live P&L |
| --- | --- | --- | --- | --- | --- |
| SPY | long | 09:55 | 1.46 | 0.69 | **−52.7 %** |
| SPXW | long | 10:00 | 10.29 | 3.15 | **−69.4 %** |
| MU | long | 09:55 | 7.00 | 3.78 | **−46.0 %** |
| META | short | 10:40 | 4.45 | 2.22 | **−50.1 %** |
| QQQ | short | 10:20 | 6.53 | 11.53 | **+76.6 %** |
| INTC | short | 12:51 | 0.38 | 0.19 | **−50.0 %** |
| AMD | long | 09:50 | 8.45 | 4.40 | **−47.9 %** |
| NVDA | long | 12:40 | 2.62 | 1.12 | **−57.3 %** |

- 1W/7L. Five entries in the first 50 minutes; the longs (SPY/SPXW/MU/AMD) were flagged into a tape that sold off
  all day (the board's own end-of-day fresh find was **SPY short**, score 93). The intraday/market-align layer
  *penalized* these scores (−6 align, −5 opening chop) but nothing **blocks** a counter-tape or opening-window
  entry — compare Slayer, where no BUY exists before 9:50 *and* a mixed tape or missing regime blocks outright.
- META short vs Night Hawk's 7/10 edition LONG A on META — surfaced to members only as a whisper-echo, not as a
  conflict gate (Slayer has an explicit satellite-conflict module).
- Every row's conviction is "C" — dossier enrichment rarely upgrades intraday finds; the deterministic dossier
  score is a swing-horizon instrument being asked an intraday question.
- `zerodte-health`: 8 candidates scanned today, 8 committed, **0 rejections** — on a −0.5 % SPY day the gate stack
  rejected nothing. Evidence gates measure *flow conviction*, not *trade quality*.
- **Structural gap:** the plan grades (`plan_outcome`/`plan_pnl_pct`) exist per-row, but **no API or page aggregates
  0DTE Command's multi-day record** — `/api/track-record` covers SPX Slayer + Night Hawk editions only. The most
  active play surface on the platform is the only one whose track record members cannot see.

### 2.3 Night Hawk editions — 30-day window

- Funnel: 41 candidates → 26 published, 15 rejected (10 ungrounded, 3 illiquid strike, 2 geometry).
- Outcomes: **14 resolved, 12 pending** (a 46 % pending backlog), 42.9 % win rate, profitable rate 58.3 %,
  avg winner +6.13 %, avg loser −1.17 %, profit factor 4.2 — *on stock-move math from the entry-band midpoint*;
  the member trading the suggested contract sees very different (0DTE-style) P&L variance.
- Conviction is inverted at the top: A+ n=1 → 0 % win (−6.6 %); A n=4 → 75 %; B n=8 → 37.5 %. Score buckets are
  non-monotonic (40–54: 0 %, 55–69: 67 %, 70–84: 25 %, 85–100: 100 % — tiny n throughout).
- Geometry escapes (all graded into the public record):
  - **AMD 2026-07-07 (A+):** entry 550–555, stop **550.88 inside the entry band** — a fill at 550 starts below its
    own stop. Geometry gate checks stop < *midpoint* (552.5) only (`validatePlayGeometry`, `play-constraints.ts:126`).
  - **AMAT 2026-06-29:** entry 657.5–662.5, **target 662.5 = entry_range_high** — graded `stop` while the stock
    closed +5 % at 694.64 next session. A target inside/at the band is unearnable edge.
  - **AMD 2026-07-01:** target +3.1 % vs stop −9.3 % (R:R 0.33) — graded `target`. **MRVL 2026-07-01:** stop −16.4 %.
    No R:R floor exists on editions (Slayer blocks < 1.2).
  - **OKTA/MRK 2026-06-29:** `entry_range_low = 17` vs highs ~115 — the known corrupt-parse class; now neutralized at
    read time by `entryRangeMid`'s 20 % width guard but still present as raw rows.
- **Today's edition (for 2026-07-13, published Fri 21:30 UTC) contains 0 plays** (recap-only), and the 9:15 morning
  confirm blob has `plays: []` with `spx_premarket/prior_close/regime/gex_bias` all null — the confirm cron ran
  against an empty edition and captured no market context. Members got no Night Hawk plays for Monday while the
  0DTE Command board fired 8.

---

## 3. Comparison verdict

| Dimension | SPX Slayer | 0DTE Command | NH edition | NH day-trade agent |
| --- | --- | --- | --- | --- |
| Regime awareness | Router + hysteresis + gamma desk | none (score nudges only) | regime multiplier at score time | SPX-bias filter |
| Entry gating | 20+ gates, fail-closed | 4 evidence gates, quality-blind | critic + grounding + geometry(mid) | DTE + alignment |
| Risk portfolio layer | governor (caps/cooldowns/locks/VIX) | none | sector cap, premium cap | none |
| Exit engine | VIX-indexed, trailing, force-exit 15:45 | fixed −50/+100/15:30 | next-day target/stop only | none |
| Strike selection | delta band by grade, liquidity scored | top flow strike (whatever the tape bought) | most-ATM + OI floor | inherited |
| Accountability | full ledger, adaptive gates | per-row grades, **no aggregate surface** | stock-move ledger | **none** |
| Breadth | SPX only | any ticker w/ 0-1DTE flow | ≤5 stocks/evening | scan universe |

**Which 0DTE signal quality is better and why:** Slayer, decisively — not because its *signals* are smarter but
because its **gate stack converts a ~42 % raw-signal environment into a 48 % closed ledger with capped losses**,
while 0DTE Command converts high-conviction *flow evidence* directly into entries with no market-state veto: the
one thing 7/13 proves is that dominant call flow at 9:55 on a distribution day is a fade, not a follow. What
0DTE Command has that Slayer can't: **breadth** (QQQ short +76.6 % came from it), real fill-anchored contract plans
(enter-at-or-below what the flow paid, chase guard), and an always-on rejection log. These are complementary, not
competing, strengths.

---

## 4. Fixed on this branch (clear bugs, with tests — `npx tsx`-suite green, tsc green)

1. **Index-root 0DTE plays were permanently ungradeable** (`src/lib/zerodte/scan.ts`, `board.ts`).
   Polygon serves index aggs only under the `I:` namespace; `SPXW`/`SPX`/`NDX` return HTTP 200 with 0 results
   (live-verified: `SPXW` → 0 results; `I:SPX` → o 7547.64 / c 7575.39 for 7/10). `gradeZeroDteLedger` fetched
   daily bars by raw row ticker, got `close=null`, and stamped the row `graded` with null `direction_hit` forever —
   the empty-success path bypasses the retry catch. The intraday edge read (`intradayReadFor`) had the same hole, so
   index setups (like today's SPXW long, −69 %) never got VWAP/OR/trend conflict detection. **Fix:** `polygonSpotTicker()`
   mapping (SPX/SPXW→I:SPX, NDX/NDXP→I:NDX, RUT/RUTW, XSP, VIX), applied at both call sites; unit tests for the
   mapping + a wiring test proving a SPXW row grades from the `I:SPX` close (`board.test.ts`, `scan.test.ts`).
   Note: rows already stamped with null grades stay null — a one-off backfill (clear `graded_at` where
   `close_price IS NULL` and ticker in the index set) must run from an environment with DB access.
2. **pg DATE columns leaked as `String(Date)` into member payloads** (`src/lib/bie/ecosystem-context.ts`, `db.ts`).
   The 0DTE board's `nighthawk_echo.edition_for` shipped
   `"Fri Jul 10 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"` (live capture, 7/13) — same for
   `zerodte_today.session_date` in the BIE ecosystem context. This is a recurrence of the exact class db.ts's
   `isoDateString` was written for (#77 Bug 1); ecosystem-context runs raw `dbQuery`s and re-introduced it.
   **Fix:** exported `isoDateString` from db.ts and applied it to `mapNighthawkEchoRows` + `fetchEcosystemContext`'s
   DATE fields; regression test with a real `Date` object row.

## 5. Proposals (judgment calls — documented, NOT coded)

- **P-1 Geometry gate must validate against the band, not the midpoint:** require `stop < entry_range_low` and
  `target > entry_range_high` (direction-mirrored) in `validatePlayGeometry`, plus an R:R floor (Slayer uses 1.2).
  Would have rejected AMD 7/07, AMAT 6/29, AMD 7/01, MRVL 7/01 — i.e. ~29 % of the resolved sample.
- **P-2 Market-state veto for 0DTE Command:** promote `intraday_conflict` + `market_aligned:false` + opening-window
  (before ~9: 50) from score dents to **entry blocks** (ledger-persist blocks, keep them visible as SKIP cards).
  7/13 evidence: all four opening-window longs died at the stop; the one aligned short was the only winner.
- **P-3 Surface the 0DTE Command aggregate track record:** extend `/api/track-record` (and the admin page) with
  `zerodte_setup_log` plan-outcome aggregates (win rate by doubled/stopped/time_stop, by time-of-day bucket, by
  direction-vs-SPY-bias). The data is already graded; it is simply unqueried.
- **P-4 Index setups should use the index dossier:** `scanZeroDteBoard` enriches SPXW/SPY through the single-name
  dossier (fundamentals/insider N/A → conviction floor "C"); route index roots to `index-dossier.ts`.
- **P-5 Retire the Day-Trade Agent lane** (see migration below) — an ungraded play surface violates the platform's
  own honesty rule; keep the hunt UI but back it with 0DTE Command's ledgered pipeline.
- **P-6 Backfill job** for historical null-graded index rows (see fix 1).
- **P-7 Timestamptz fields in ecosystem-context** (`first_flagged_at`, `fired_at`) still serialize via `String()`;
  normalize with the same discipline (cosmetic for LLM consumers, no member surface currently affected).

---

## 6. Migration: "all 0DTE plays live in Night Hawk 0DTE"

**Principle:** unify the *member surface and accountability*, not the codebases. SPX Slayer's engine is the most
verified component on the platform — moving its logic would be regression roulette for zero member value. Make
"Night Hawk 0DTE" the single intraday umbrella that *presents* three engines' output under one ledger discipline.

**Phase 1 — one pane, one record (low risk, UI/API only).**
New `Night Hawk 0DTE` tab presenting: SPX Slayer live play (existing payload, read-only), 0DTE Command
setups/ledger, and the NH edition's morning-confirm status. One combined track-record endpoint (Slayer pnl-pts +
0DTE Command plan-outcomes + NH stock-move, clearly labeled — never blended into one win rate). Prereqs: P-3.

**Phase 2 — shared vetoes (medium risk, engine-adjacent).**
0DTE Command adopts Slayer's market-state inputs as *blocks*: SPY/desk bias conflict, opening-window,
macro hard-block windows, and a session governor (max concurrent plays, max session stops — today had 7).
Cross-system conflict gate: a 0DTE Command flag opposing today's NH edition direction or the live Slayer play is
surfaced as CONFLICT, not silently listed. Slayer untouched except config.

**Phase 3 — merge the redundant lane (code deletion, the only true migration).**
Day-Trade Agent (hunt `mode:"day"`) dies as an independent generator; the hunt UI re-backs onto 0DTE Command's
pipeline (same gates, same ledger, same grading). Net: four 0DTE surfaces → two engines (Slayer for SPX,
0DTE Command for breadth) under one Night Hawk 0DTE presentation.

**Phase 4 — evaluate, don't assume.**
After ≥30 sessions of Phase-2 data, decide with numbers whether 0DTE Command earns Slayer-style playbook promotion
machinery, and whether NH editions should stop publishing 0-1 DTE contracts entirely (leaving overnight/swing as
the edition's identity — which today's data already suggests it is).

**What dies:** Day-Trade Agent generation path; the un-aggregated 0DTE record gap; midpoint-only geometry.
**What must not change:** Slayer's engine/gates/governor; 0DTE Command's honest evidence-only cards; the
edition's grounding/critic pipeline.
**Risk notes:** Phase 2's blocks will cut 0DTE Command play volume sharply on trend days (that is the point —
but set expectations); combined track record must keep methodologies separate or it becomes marketing, not record;
the NH edition dedupe (`nighthawk_covered`) must extend to the unified surface or members see the same ticker
twice with different plans.

---

## 7. Appendix — persistence quick map

- SPX Slayer: `spx_open_play`, `spx_play_outcomes`, `spx_playbook_shadow_observations`, `spx_playbook_instances(+events)`,
  `platform_meta:spx_play_session_meta`; Redis only for desk snapshot caches.
- 0DTE Command: `zerodte_setup_log` (PK session_date+ticker; plan_json/plan_outcome/status/peak/trough),
  `zerodte_scan_rejections`, `alert_audit_log(alert_type='zerodte')`; Redis server-cache `zerodte:board:v1` (5 s),
  `zerodte:dossier:{t}:{d}` (10 m), `zerodte:intraday:{t}:{d}` (3 m).
- Night Hawk: `nighthawk_editions`, `nighthawk_play_outcomes`, `nighthawk_jobs`, `nighthawk_scoring_history`,
  `alert_audit_log`; Redis `nh:play-status:{date}`.
