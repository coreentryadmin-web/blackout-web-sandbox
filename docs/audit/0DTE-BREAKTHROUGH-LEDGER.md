# 0DTE breakthrough ledger — living idea log (never stop thinking)

**Standing directive (user, 2026-07-13):** keep questioning/debating at every stage of the 0DTE
build ("0DTE" = SPX Slayer plays + 0DTE Command). This ledger is the running output: every idea
gets a debate, a verdict, and a status. Ideas are cheap; graded evidence decides survivors.
Statuses: BUILDING / QUEUED / CALIBRATE-FIRST / REJECTED (with reason — rejected ideas stay listed).

## Wave 2 (2026-07-13 late night — post-Cortex-design)

### B-1 · Evidence-driven EXITS — the neglected half (QUEUED → next build phase, PR-E)
Every gate built tonight protects the entry; Friday's 7 losers then rode passively to −50%.
The evidence that justified an entry must STAY ALIVE for the trade to stay open:
- Opposing sweep cluster arrives → exit signal (don't wait for the stop).
- Opposing wall starts BUILDING in the path (wall-trend flip) → tighten stop to breakeven-.
- King node migrates against the play → scratch.
- **Flat-timeout**: 0DTE premium bleeds theta; a play flat for ~45 min is losing while price
  stands still → scratch at small loss instead of riding to −50. (Friday's −46/−47/−52% class
  were mostly slow bleeds, not gaps — a flat-timeout takes half the loss.)
Debate: risk of over-exiting winners — so exit signals are TIERED (exit / tighten / warn) and the
counterfactual grader measures what exited plays would have done. Expected: biggest expectancy
lever in the whole program (halving avg loss beats +10pts of win rate at this payoff).

### B-2 · Opening harvest 9:30–9:45 — turn the restriction into alpha (QUEUED, Cortex source)
User cut the block to the first 15 min. Don't idle there — HARVEST it: opening range vs overnight
gap, gap-and-go vs gap-fade shape, first-15m internals (TICK/ADD trend), auction aggression from
flow prints. At 9:45 unlock, this becomes a fresh, high-weight Cortex evidence item exactly when
the user expects most plays to fire. The block window becomes the scanner's warm-up lap.

### B-3 · Correlated-contradiction governor (BUILDING — folded into G-5)
Friday ran SPY long AND QQQ short simultaneously — correlated instruments, guaranteed one loser.
Governor extension: block a new commit whose direction contradicts an OPEN play on a highly
correlated ticker (static correlation groups first: SPY/QQQ/IWM/DIA + index roots; sector pairs
later). Cheap, obvious in hindsight, caught by nobody's gate list.

### B-4 · Size tiers by evidence (CALIBRATE-FIRST, conservative version ships with UI)
Fixed size treats a 9-source-confluence A play like a bare-minimum pass. Ship "suggested size"
chips (0.5×/1×) from Cortex score + VIX band with deliberately conservative mapping; the
calibration loop earns any richer sizing (Kelly-style) only after ≥30 sessions of per-source hit
rates. Never auto-sizes beyond 1× — leverage is the user's call, always.

### B-5 · Session-archetype memory ("days like today") (QUEUED, classifier first)
Classify each session from context we already persist (gamma regime at open, VIX band, gap %,
first-15m internals): trend-up / trend-down / pin / whipsaw. Cortex adds an archetype evidence
item once history accumulates: "counter-tape longs on trend-down days: 0/9" beats any heuristic.
Ships as classifier + logging now; speaks only when n≥threshold per archetype.

### B-6 · Monday-morning self-review, automated (QUEUED, rides the calibration loop)
Weekly auto-report: per-gate saves (blocked plays' counterfactual outcomes = losses prevented),
per-source hit rates, skipped-winner cost, and PROPOSED threshold tweaks with the evidence for
each. The system argues for its own tuning; the user approves with data in front of him.

### B-7 · Readiness light (QUEUED, small)
Formalize fail-closed: a member-visible "engine readiness" state (all veto-capable sources fresh
within SLA). Degraded feeds = no new commits + an honest amber light, never silent degradation.

### Rejected this wave
- **IV-extreme premium veto / spread conversion** — REJECTED for v1: changes plan STRUCTURE
  (single-leg → spreads), a product decision beyond "best plays only"; revisit after the
  calibration loop proves the entry engine. Logged so it isn't lost.
- **LLM-assisted headline interpretation** — REJECTED permanently for the money path (platform
  rule: deterministic only where money moves; LLM stays in narration surfaces).

## Wave 3 (2026-07-14 — user-driven: exits + data integrity)

### B-8 · Profit ratchet — "a meaningfully green trade never finishes red" (SHIPPED — exit engine)
User rule, debated to its honest form: a literal never-red lock at +1% would scratch winners into
0DTE noise (contracts oscillate ±15% doing nothing). Design: ACTIVATION THRESHOLD ratchet —
at +25–30% premium the floor locks at breakeven+fees; +50% → floor +20%; the +100% trim banks
half and the runner's floor never drops below +50%. Thesis-break exits are UNCONDITIONAL and
independent of P&L (alignment flip / opposing wall building / opposing sweep cluster → exit at
market with the evidence line attached). Thresholds are v1 constants; the counterfactual exit
grader (B-1) measures scratched-winner cost vs saved-losses and tunes them with data.
**Shipped as `src/lib/zerodte/exit-engine.ts`** (pure, no-LLM core: ratchet floors derived from the
latched peak so they are monotonic by construction; thesis-break off Cortex evidence — one veto or
an opposing cluster past the entry's committed score margin; 45-min ±10% flat-timeout for theta
bleed; plan stop/target authority; documented precedence) **+ `exit-sync.ts`** (freshest-mark wiring
into `syncLedgerLiveState` — live-marks lane preferred when fresh; 30s-cached fail-soft Cortex
evidence; `entry_context.exit` counterfactual stamp = the B-1 grader's raw material).

### B-9 · P0 — live marks lane: sub-second trade data + the wrong-P&L defect (BUILDING)
User report (P0): 0DTE plays open and then "the entire data is wrong — pnl, %, premium values";
chain data broken/slow; slow render/update. Requirement: every number on an open trade updates
~1s. Two distinct problems, two fixes:
1. **Correctness**: diagnose the wrong-values class with evidence (suspects: 2-min grid-warm cron
   marks presented as live; entry premium from flow price vs marks from a different field
   (last vs mid); index-root chain misses pre-#309; cache layers serving different asOf to
   different components). Every displayed number gets ONE authoritative derivation + an asOf
   stamp; mixed-provenance math (entry from one lane, mark from another) becomes structurally
   impossible.
2. **Latency**: dedicated live-marks lane for ACTIVE contracts only (bounded set — open ledger
   plans, ≤~12 contracts): server-side options WS subscription (UW/Polygon socket infra already
   runs server-side) → in-memory mark store → SSE push to members at ~1s cadence (browser SSE,
   the platform's existing WS-free client pattern) with REST fallback at 2–3s. P&L computed from
   pushed marks against the PINNED entry premium (never re-derived). Chain SNAPSHOTS (full board)
   stay on their cadence — it's the open-trade numbers that must be ~1s, not the whole chain.
   Freshness stamp rendered on every number; stale >5s dims (stale-honesty, applied to money).
