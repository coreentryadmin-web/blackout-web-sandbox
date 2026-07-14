
## Wave 3 (2026-07-14 — user-driven: exits + data integrity)

### B-8 · Profit ratchet — "a meaningfully green trade never finishes red" (BUILDING, exit engine spec)
User rule, debated to its honest form: a literal never-red lock at +1% would scratch winners into
0DTE noise (contracts oscillate ±15% doing nothing). Design: ACTIVATION THRESHOLD ratchet —
at +25–30% premium the floor locks at breakeven+fees; +50% → floor +20%; the +100% trim banks
half and the runner's floor never drops below +50%. Thesis-break exits are UNCONDITIONAL and
independent of P&L (alignment flip / opposing wall building / opposing sweep cluster → exit at
market with the evidence line attached). Thresholds are v1 constants; the counterfactual exit
grader (B-1) measures scratched-winner cost vs saved-losses and tunes them with data.

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
