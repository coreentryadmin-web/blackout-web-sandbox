# BIE design notes — requirements, principles, and decisions

This doc consolidates everything decided in conversation about BIE's design
that doesn't already have a home in the other three docs. Read it alongside:

- **`ARCHITECTURE.md`** — the L1-L5 layer design, what's shipped, honest
  realism about what "learning" actually means here.
- **`FULL-SYSTEM-AWARENESS.md`** — the formal primary-objective charter, the
  full ask, and the Stage 1-5 rollout status (what's shipped / partial / blocked).
- **`AUDIT-TRAIL-SCHEMA.md`** — the detailed per-alert audit-trail schema
  design (Stage 4).

This doc is the "why" and "what we decided" layer — the reasoning that
would otherwise only live in chat history.

## The one rule everything else follows

**BIE (the LLM layer) must never be the source of truth for correctness.**
Accuracy comes from validation systems, audit trails, deterministic
calculations, and source-of-truth checks — all plain code, independently
verifiable. BIE's job is to **detect, explain, rank, and help fix** issues
a validation layer already found. It never decides on its own that
something is correct.

The pipeline, as stated directly: raw API data → validation layer →
calculation engine → database/cache → backend API → frontend display →
UI validation → **BIE audit** (last step, reads everything upstream of it,
adds nothing upstream of it). This is not new — it's the same rule L1
Deterministic already held ("no LLM computes a trading number"), extended
to say BIE can't invent a *correctness verdict* either, not just a number.

## Two different "is this number correct" problems

These get confused if not kept separate — they have different answers:

**1. Raw/mirrored values** — price, OI, IV, greeks, strike totals — anything
that mirrors an upstream provider's own number. These have a real external
ground truth (Polygon/UW's own REST response), so they can be checked by
diffing against it directly. This is what `data-correctness` (30min RTH
cadence) and `data-integrity` (5min RTH cadence) crons already do,
continuously, in production — shadow-recompute, cross-provider, cross-tool,
freshness checks across heat maps, SPX desk, HELIX flows, Night's Watch,
Night Hawk, track record. They already distinguish "independently
confirmed" (checked against a real second source) from "consistency-only"
(no second source exists, honestly labeled a coverage gap, never a false
green) — this is the exact honesty principle the primary-objective charter
asks for, already built, before the charter was ever written down.
`data-integrity` auto-opens a real incident (`admin_incidents`) the moment
two tools disagree. **BIE's discovery report reads both systems' output now**
(shipped — see `docs/audit/FINDINGS.md`, "discovery now reads the
already-running data-integrity/data-correctness validators").

**2. Derived/composite values** — a conviction score, a composite regime
label, a discovered candidate's rank, a King node calculation. There is no
external "correct" answer to diff against — Polygon can't tell you whether
a Night Hawk score of 73 is right, because that number only exists inside
our own logic. The only thing checkable here is **internal consistency**:
does the output match what the inputs say it should. The GEX-heatmap
total-vs-strike-sum bug (2026-07-03) is the concrete example — an internal
consistency check, not a ground-truth check, and it's exactly the kind of
bug ground-truth checking against Polygon would never have caught (Polygon
has no concept of "our displayed total"). This class of correctness is what
the **Stage 4 audit trail** (`AUDIT-TRAIL-SCHEMA.md`) is for — not "is this
number right" but "can I see why the system arrived at it," which is the
only thing that's answerable for a derived value.

**"Check every number" therefore splits into two real, different
commitments:** continuously ground-truth-check everything that has an
external truth to check against (a scheduling/coverage problem, largely
already solved by the two crons above — BIE just needed to start reading
them), and make every derived number's reasoning traceable (a data-model
problem, Stage 4, real design work still in progress).

## What "impactful" actually means — a standard to hold future work to

Established while assessing the session's own progress, worth reusing:
a BIE change is impactful if it **catches something that was actually
wrong** that would otherwise have sat silent — not just "added a metric" or
"more logging." Concrete evidence from this session, both directions:

- **Real:** the Postgres deadlock fix (#307) was found because the
  already-shipped frontend/backend error capture caught a genuine
  production error via `error_events`, same night it shipped. That's the
  loop actually working.
- **Not BIE, worth being honest about:** BIE did *not* catch the GEX
  heatmap total-mismatch bug, the AAPL chain-truncation bug, or the
  Postgres-password-in-build-logs leak. A separate audit script caught the
  first two; a human (screenshots) plus manually-pulled Railway logs caught
  the third. If something goes wrong silently — no throw, no logged error,
  no telemetry BIE has access to — it won't see it. That's true of any
  monitoring system, not a BIE-specific flaw, but it means "BIE will catch
  everything" is a claim to actively resist making, including to ourselves.

The honest self-check for any future BIE feature: does this let BIE surface
a REAL validated problem faster than a human would notice it, or does it
just add a chip to a dashboard nobody was missing.

## Play-outcome learning — a distinct, secondary objective

Explicitly ranked second to data integrity by the user's own charter. What
exists today: 0DTE ledger (`plan_outcome`/`plan_pnl_pct`) and Night Hawk
(`nighthawk_play_outcomes`, win/loss grading) already capture "was this
play later correct" — real outcome data, accumulating every trading day.
What does **not** exist yet: anything that closes the loop by using that
outcome data to actually adjust the scoring logic (gate thresholds, scorer
weights) over time. Every threshold/weight change made this session was
evidence-based but human-driven — someone looked at data and opened a PR.
There is no automated "BIE watches its own play outcomes and proposes a
calibration change" loop for the trading engines specifically (there IS one
for BIE's own retrieval floor / self-eval, per `calibration.ts`, but that's
about BIE's own answer quality, not the trading scorers).

This is real, valuable, **not scoped yet** — a future "Stage 5," and it
should follow the same evidence-based standard already established
everywhere else in this codebase: minimum sample sizes
(`TRACK_RECORD_MIN_SAMPLE = 30`), "never tune on noise," proposals surfaced
for human review rather than auto-applied, given how high-stakes changing
live trading logic is. Scoping it properly is future work, not a same-night
patch — same standard Stage 4 was held to.

## Where BIE fits relative to Claude (honest, not aspirational)

`ARCHITECTURE.md`'s own framing already answers this correctly: Claude is
"the general-reasoning fallback, not the foundation." The router (L3)
answers an increasing share of factual questions with zero LLM cost and
zero hallucination risk by reading source-of-truth engines directly;
Claude stays as the fallback specifically for open-ended reasoning
questions that don't map onto a deterministic answer. "Replacing Claude"
was never really the right frame — the goal is router coverage growing
over time (tracked, queryable, not vibes: see `ARCHITECTURE.md`'s success
metrics), not eliminating the fallback. Nothing found this session changes
that assessment.
