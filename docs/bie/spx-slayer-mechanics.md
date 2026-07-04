# SPX Slayer — play engine mechanics

SPX Slayer is the desk's real-time 0DTE SPX play engine. This doc describes how it actually
decides to fire, hold, or veto a play — the data it reads, the three-stage decision pipeline
(confluence scoring → sequential gates → AI arbiter), the numeric-grounding guard on the AI
step, and where its live state lives in Postgres. It is written for BIE's retrieval layer, so
Largo can answer "how does the play engine decide" or "why does SPX Slayer have a separate AI
verdict step" from real mechanics instead of inference. Source of truth: `src/lib/spx-signals.ts`
(scoring), `src/lib/spx-play-gates.ts` (gates), `src/lib/spx-play-claude.ts` (AI arbiter),
`src/lib/spx-play-payload.ts` and `src/lib/spx-play-engine.ts` (orchestration/payload). If code
and this doc ever disagree, the code wins — flag the drift.

## Data pipeline — `buildSpxDesk()`

Everything downstream reads one snapshot object, `SpxDeskPayload`, built by `buildSpxDesk()`
(`src/lib/providers/spx-desk.ts`). It pulls, in parallel: Polygon index snapshots for SPX/VIX/
VIX9D/VIX3M/TICK/TRIN/ADD, SPX 1-minute bars for session VWAP/HOD/LOD, daily bars for the prior
session's OHLC, EMA/SMA series, a breadth-universe snapshot, Benzinga market news, and (when
enabled) an internal engine-intel overlay. Polygon is the sole GEX source (dealer gamma walls,
gamma flip, gex king, net GEX) via `resolveCanonicalDeskGex`. When Unusual Whales is configured,
a pooled batch of UW calls adds market tide, SPX NOPE, 0DTE flow net, dark pool prints, max pain
(UW fallback only if Polygon's canonical GEX didn't already resolve it), and IV rank. A recent
SPX/SPY sweep tape and a unified cross-instrument "tape" feed are fetched separately for the
flow-alignment and live-tape scoring inputs. The desk fails closed to an empty/unavailable
payload if Polygon isn't configured or the SPX price snapshot is missing — nothing downstream
ever scores or gates on a null price.

## Stage 1 — Confluence scoring (`computeSpxConfluence`)

`computeSpxConfluence(desk)` turns the desk snapshot into a single signed score in [-100, 100]
by summing independently-weighted factors, each pushed onto a `factors[]` list with its own
label/weight/detail so the reasoning is inspectable, not a black box. Factors include: VWAP
position (±12), gamma regime vs. gamma flip (±10, only scored in the regime-matching direction —
mean-revert above flip, amplification below), GEX support/resistance proximity (±18, mutually
exclusive when both walls are in range — only the nearer wall scores, to stop a rangebound
market from adding both a positive and negative wall hit at once), GEX king/anchor proximity
(±6), max pain proximity (±5), 0DTE net flow (±14, needs >$150K net premium to count), dark pool
bias (±3 — deliberately small; block prints are multi-day, not same-day alpha), market tide
(±10), NOPE (±7), IV rank fade/squeeze adjustment (±4), NYSE TICK (±4 to ±10 by extremity), TRIN
(±6), and ADD (±5).

Further factors: mega-cap leadership average (±6), recent unified-tape call/put skew (±12), EMA20
position (±5), net-premium-tick acceleration (±6), VIX9D/VIX3M term-structure divergence (±8/+4
for backwardation/contango), a session time-of-day adjustment (+6 morning ORB and power-hour
windows, −8 lunch chop), HELIX institutional 0DTE sweep alignment (±10 to ±15, tiered by size and
call:put ratio), a macro-news keyword scan (−6 to +3), and a flow-strike concentration bonus (+3
when the dominant strike stack has more than 3 repeated same-direction institutional prints
within 30 points of spot).

The raw sum is clamped to [-100, 100]. From the clamped score: `action` is `BUY_CALL`/`BUY_PUT`
at |score| ≥ 22, `HOLD` at |score| ≥ 10, else `WAIT`. `direction` (`long`/`short`/null) mirrors the bias. `grade` is computed by
`scoreToGrade(absScore, conflicts)` — A+ needs abs score ≥72 and ≤1 conflicting factor, A needs
≥58 and ≤2, B needs ≥45 and ≤3, C needs ≥30, otherwise D. `conflicts`/`weighted_conflicts` come
from `computeWeightedConflicts()` (`src/lib/spx-play-conflicts.ts`): the raw count of factors
opposing the score's direction, plus a desk-aware weighted variant that double-counts "hard"
opposing signals (market tide, dark pool, IV rank, gamma regime, GEX walls) and adds weight for
opposing news sentiment, tide, GEX, or an extreme VIX reading even when those didn't fire as a
scored factor — this is what later gates a "mixed tape" block on, separately from the grade
itself. `confidence` is a simple function of |score| and factor count, clamped to [0, 96].

Entry/stop/target/invalidation levels are built from the nearest GEX wall (with a 3-point buffer,
since price commonly wicks through a wall before reversing) and a VIX-indexed target distance —
wider targets on higher-VIX days, not a fixed point count. Separately, a same-day Night Hawk
prior (`src/lib/spx-play-engine.ts`) can add ±3 to the score as one more factor when a fresh
(<20h old) Night Hawk edition shows a clear 3+ A-grade directional cluster — a soft morning bias,
never large enough to flip a setup on its own.

## Stage 2 — Sequential entry gates (`evaluatePlayGates`)

Passing confluence is necessary but not sufficient to trade. `evaluatePlayGates()` runs a
sequential checklist of hard blocks and soft warnings before any entry is considered, evaluated
twice per cycle — once with buy intent, once with watch intent, since some blocks (grade
minimum, mixed-tape) only apply to committing capital, not to logging a WATCH state. In roughly
the order they're checked: market must be open; a confirmed live trading halt blocks (a merely
*stale* halt feed fails OPEN with a warning instead, since blocking every entry on a transient UW
feed gap was judged worse than the rare miss); GEX walls must be present (no entry without a
dealer map); the desk snapshot must be fresh (age-gated in seconds, combining poll age and GEX
age); `weighted_conflicts` must stay under a grade-scaled "mixed tape" ceiling (A-grade setups
tolerate one more conflicting signal than B, which tolerates more than C/D); `grade` must clear a
minimum rank (B or better, by default).

Continuing the checklist: a macro hard-block window fires around scheduled CPI/FOMC/NFP/PPI/GDP
releases (a tight window for precise-timed releases, a full-morning or ±15-minute Fed-decision
window for imprecise ones); no buys before cash open or after a configured no-entry cutoff, and
none in the first minutes of the session or the opening-range window (watch is still allowed in
that window); |score| must clear a minimum floor.

A buy-side cooldown applies after any exit (with an optional bypass for a fresh A+ setup); a
longer cooldown applies specifically after a stop-out; a same-direction re-entry lock applies
after a losing exit; the flow feed must not be stale (unless a cluster heartbeat confirms another
replica has live data); risk:reward to the computed stop/target must clear a minimum ratio; VIX
above a ceiling blocks new entries outright (a lower elevated-VIX threshold only warns); the
number of agreeing factors must clear a minimum; and finally the confirmations checklist (next
section) must pass.

`entry_mode` comes out as `"full"`, `"starter"`, or `"none"` depending on how far above the score
floor the setup is and how many weighted conflicts it tolerates for that grade — `"starter"` is
a smaller-size mode that
can be disabled entirely via config to require full A/A+ setups only. Any single unresolved block
keeps the desk in `SCANNING` (or `WATCHING` when a setup is close but not there) — `SCANNING` is
the default, honest state, not an error.

Alongside the entry gates, `evaluatePlayConfirmations()` (`src/lib/spx-play-confirmations.ts`)
runs an independent 10-item checklist: four **required** checks (3-minute multi-timeframe close
confirmation, 5-minute trend/RSI confirmation, support/resistance structure alignment, and a
breakout-or-level-hold check) plus six optional checks (0DTE flow alignment, dark pool bias,
market tide, NYSE TICK internals, news catalyst direction, dealer GEX wall presence, and vol
regime). All four required checks must pass, and the total passed count must clear a configured
minimum, or the confirmations result — and therefore the gate result — fails.

## Stage 3 — The AI arbiter (`evaluateClaudePlayApproval`)

Only after every mechanical gate has already passed does the engine consult
`evaluateClaudePlayApproval()`. This step exists because the deterministic gates catch structural
misses (stale data, bad R:R, cooldowns, low score) but can't judge messy, judgment-call setups —
whether a technically-passing setup still "feels" mixed once flow, tide, and news are read
together, the way a human desk would eyeball it before pulling the trigger. The step is
feature-flagged (`SPX_CLAUDE_GATE`, off by default) rather than always-on: when the flag is off
and the call isn't otherwise forced (which happens on a WATCH→ENTRY promotion when telemetry has
marked that promotion path as needing AI confirmation), the arbiter never calls Claude at all —
it substitutes a deterministic `mechanicalVerdict()` that approves only when gates passed, a
direction exists, grade is B or better, and confirmations passed, with no AI in the loop. This
means "the AI arbiter" is more precisely "an optional AI upgrade to an always-present mechanical
arbiter," not a mandatory hop.

When the flag (or a forced call) IS active, the behavior is deliberately **fail-closed**: if
Anthropic isn't configured, if the daily Claude-call budget (a persisted per-day counter) is
exhausted, or if the model simply doesn't respond in time, the play is **vetoed** — the engine
does not silently fall back to the mechanical check in this mode, because that would defeat the
point of requiring AI confirmation in the first place.

A short in-memory-plus-Postgres cache (keyed by direction/grade/rounded score/bucketed price)
avoids re-asking Claude for materially identical setups within a cache window. When Claude is
actually called, the prompt hands it the same desk/confluence/technicals/confirmations data
already computed — price and structure, GEX/
dealer positioning, flow and tape, multi-timeframe technicals, news/macro, the full confluence
factor list, and the confirmations checklist — and instructs it to default to VETO whenever
anything is mixed, approving only when grade is A/A+, both 3m and 5m timeframes align with
direction, support/resistance or breakout context is clean, flow/tide/news don't oppose the
trade, and risk:reward is sensible. The response is constrained to a small JSON verdict object
(verdict, direction, headline, thesis) requested at temperature 0 for deterministic parsing, not
prose generation.

## The numeric-grounding guard

Claude's free-text thesis ships into a real-money play card, so before a Claude-sourced verdict
is trusted, its thesis is checked against `checkNumbersGrounded()` (`src/lib/grounding-guard.ts`)
using the exact set of "known" numbers built by `knownPlayLevels()` — desk price, VWAP, HOD/LOD,
prior-day high/low, gamma flip, gex king, max pain, every named level and GEX wall strike, the
confluence's own entry/stop/target, and the multi-timeframe close/EMA values — i.e. only numbers
that were actually fed into the same prompt. If the thesis cites any plausible price-like number
that isn't in that set (within a small tolerance), the entire verdict is discarded — not just the
prose — and the engine falls back to the deterministic mechanical verdict instead, logging the
ungrounded attempt.

This mirrors the same grounding pattern used elsewhere in the platform (the
GEX-heatmap narrative explainer, Night's Watch position narration): an LLM's reasoning is allowed
to shape a decision, but never allowed to assert a number the code can't independently verify.
Every fresh (non-cached) Claude verdict — approved or vetoed, grounded or not — is written to the
unified `alert_audit_log` table (`alert_type: "spx_claude_play"`) as a durable record of what the
arbiter decided and why.

## After entry: exits and grading

Once a play is open, `evaluateSpxPlay()`'s open-play path checks exit conditions in a fixed
priority order every cycle: a theta force-exit cutoff late in the session (flatten regardless of
P&L — 0DTE decay makes holding into an illiquid close its own risk), then target hit, then a
trailing stop (which locks to breakeven once a play is up a few points, then trails behind the
peak by a VIX-indexed window once it's up more), then a hard stop or a thesis break (the
confluence score reversing far enough from its entry-time value) or the session simply closing,
then a partial-trim zone once a play has run far enough toward target. All of this is
price-driven, so it is suppressed whenever the desk snapshot is stale — a stale quote should
never trigger a stop or target fill.

## Where the live state lives

Every scored evaluation cycle can be logged to `spx_signal_log` (deduped by a signal key so
identical repeat evaluations don't pile up). The single open position for the current session
lives in `spx_open_play`, with a unique index enforcing at most one open play per session date.
Closed trades and their grading fields (entry path, MFE/MAE, P&L, outcome) live in
`spx_play_outcomes`, which is what telemetry, calibration, and the track record page all read
from. The Claude arbiter's verdict cache and its daily call counter live in the generic
`platform_meta` key-value table under `spx_claude_play_cache` and `spx_claude_play_daily_budget`.
Every fresh AI-arbiter verdict is additionally written to `alert_audit_log`, the same unified
audit trail every other alert-producing instrument writes to.

Largo (and BIE) can query this live state directly through dedicated tools in
`src/lib/largo/tool-defs.ts`: `get_spx_structure` returns the full raw desk snapshot;
`get_spx_confluence` returns a pure, on-demand recompute of the Stage 1 scored thesis (action,
bias, score, grade, agreeing vs. conflicting factors, levels) without touching gates or the
arbiter; `get_spx_play` returns the full play-engine payload (phase, gates, confirmations, the
Claude verdict, open-play state, telemetry) as members see it; `get_open_plays` and
`get_trade_history` read the position tables directly; `get_setup_stats` and `get_signal_log`
read the win-rate and raw-signal history. None of these tools mutate state — they all read the
same tables and pure-compute functions the desk UI itself uses, so an answer grounded in one of
them is describing the same system a member is looking at, not a separate approximation of it.
