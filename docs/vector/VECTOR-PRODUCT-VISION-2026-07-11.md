# Vector — Product Vision & Autonomous Roadmap (2026-07-11)

*Owner: Claude (full Vector mandate). Living doc — updated each build cycle. Companion to
`VECTOR-DEEP-SWEEP-2026-07-11.md` (correctness) and `docs/audit/FINDINGS.md` (issue log).*

## Thesis — what makes Vector top-tier, not "a chart with dots"

Most dealer-positioning tools (Skylit et al.) draw **static structure**: here are today's call/put
walls and the gamma flip, as beads on a chart. That's table stakes. The leap to a top-tier product
is moving from **"where is structure"** to **"what is structure about to do, and what should I do
about it"** — turning a passive overlay into an **opinionated, time-aware, self-watching desk**.

Three properties separate top-tier from mere:
1. **Time-honest history for everything, for every ticker** — structure you can replay and trust,
   recorded server-side (not viewer-dependent). *(Shipped: wall-history recorder, #139.)*
2. **Interpretation, not just data** — regime reads, magnets, proximity callouts, confidence
   scores. The product tells you what the positioning *means*.
3. **It watches for you** — alerts, proximity intelligence, flow markers. You don't have to stare.

## Shipped this cycle (foundation)
- **#138** locale-crash fix — chart renders for every runtime (was blanking on `en-US@posix`).
- **#139** server-side wall-history recorder — bead rails persist after-hours + exist for *every*
  universe ticker, not just ones with a live viewer. The engine behind honest, dense rails.
- **#140/#141** DTE-horizon walls (0DTE / weekly / monthly / all) — walls re-scope to the expiry
  horizon the member trades, on-demand so the shared stream stays fast.
- **#147 + reconstruct-server** honest intraday GEX reconstruction — gamma closed-form BSM
  recomputed along the session's TRUE observed spot path (Polygon minute bars) against the EOD
  options chain. Live-validated on SPX 2026-07-10: 395 min bars → 79 five-min beads, 9,351 usable
  contracts, gamma flip drifting 7618.5 → 7609 → 7599.8 across the day while the dominant 7600/7300
  OI walls anchor. **Unwired from the bead rail (2026-07-11, time-honest decision):** because
  intraday OI history is unpublished, the reconstruction can only replay the *closing* ladder, which
  on a range-bound day paints a flat, full-width rail (7600 wall = 5.3% at every bucket) — the
  opposite of the point-in-time dynamism a rail implies. The module lives on for the **strike×time
  heatmap (#14)**, where a dense back-projected grid is the correct primitive (a heatmap is openly a
  model; a bead is an observation).
- **Time-honest rail** *(2026-07-11)* — the wall rail renders ONLY what the live recorder captured
  point-in-time during RTH; where nothing was recorded, a single honest **as-of-close** snapshot,
  never a fabricated full-day rail. Dynamism you see is dynamism that happened.

## Roadmap — ranked by (impact × differentiation × feasibility)

### Tier 1 — analytical edge (the moat)
- **Gamma regime engine + banner** *(task #13)* — positive-gamma (dealers dampen → pin/mean-revert)
  vs negative-gamma (dealers amplify → trend). Plain-English read + flip-cross regime-change marks.
  This is the single highest-leverage interpretation layer: it reframes every wall.
- **Strike×time GEX positioning heatmap** *(task #14, BREAKTHROUGH)* — a 2D intensity map of the
  whole gamma surface migrating through the session, behind the candles. The "wow" visual that
  out-reads static beads. *(DATA LAYER SHIPPED: `reconstructGexHeatmapGrid` keeps the full
  per-strike signed net-GEX ladder per time bucket — the strike×time matrix — instead of collapsing
  to top walls; server wrapper `reconstructSessionHeatmap` reuses the rail's exact fetch/spot-path,
  Redis-cached. This is the honest primitive the reconstruction module (#21, kept out of the bead
  rail in #160) was preserved for — a heatmap is openly a MODEL, unlike the observed bead rail.
  Next slice: the canvas render behind the candles + a toggle.)*
- **Gamma magnet + expected-move cone** *(task #15)* — the gamma-weighted price hedging pulls
  toward, plus the options-implied probable range. Predictive, not descriptive. *(Magnet SHIPPED:
  strength-weighted center-of-mass, regime-honest wording — a magnet/pin in long gamma, a pivot
  that accelerates in short gamma — surfaced in the desk terminal. Expected-move cone is the paired
  follow-up: it needs ATM IV surfaced from the server, then a shaded ±1σ band on the chart.)*
- **Wall integrity/confidence score** *(task #17)* — "is this wall real?" from OI concentration +
  flow reinforcement + persistence. Stops members over-trusting a thin wall. *(SHIPPED: strength ×
  session-persistence (from the history rail) × isolation → 0–100 score + firm/moderate/thin tier
  on the top call & put wall, desk-terminal readout, tone by tier. Pure/client-derived.)*

### Tier 2 — the desk watches for you
- **Wall-proximity intelligence** *(task #16)* — chart highlight + desk-terminal callout when spot
  tests a major wall, with the dealer-hedging implication. Makes the right rail dynamic.
- **Alerts + push** *(task #19)* — arm a ticker; get pinged on wall touch / flip cross / wall break.
- **Options flow markers** *(task #20)* — large trades plotted at their strike, sized by premium —
  see the flow building/eroding walls live (UW prints already captured).

### Tier 3 — breadth & navigation
- **Real screener** *(task #18)* — sort/filter the universe by regime, distance-to-flip, wall
  strength; "most pinned" / "most explosive" views. *(SHIPPED: pure `screenUniverse` over the
  scanner rows + preset chips — All / Nearest flip / Most pinned / Most explosive — null-data
  names always sort last. Client-only, no new data.)*
- **On-demand arbitrary tickers** *(task #11)* — any optionable name, not the ~21 allowlist (GEX
  data already returns for arbitrary tickers).
- **Rail density + after-hours extension** *(task #12)* — carry the rails across the post-close gap
  to the right edge; denser cadence so every ticker reads like the flagship.

### Tier 4 — platform polish
- Replay-to-event (jump to wall form/break/flip); session-compare overlay (today vs prior day);
  saved layouts / per-user default ticker+horizon; shareable annotated snapshots; VWAP bands /
  volume profile; keyboard-driven navigation.

## Operating principles (non-negotiable)
- **Honesty over cosmetics** — never fabricate history or carry stale readings forward; disclose
  staleness, show honest gaps. The bead rail is **time-honest**: it shows only point-in-time walls
  the recorder actually observed during RTH, and an as-of-close snapshot when nothing was recorded —
  never a full-day rail back-projected from the closing chain (that reads as dynamic but isn't,
  because intraday OI history doesn't exist). Reconstruction stays where it's honestly labelled as a
  model — the strike×time heatmap (#14) — not the rail.
- **Small, tested, verified PRs** — one concept per PR, `tsc`+tests+`@apply` guard green, live-
  verified on staging where there's a runtime surface.
- **Keep the stream fast** — new interpretation layers are on-demand or client-derived; never bloat
  the shared per-second SSE fan-out.
- **Correctness is a feature** — every analytical layer is validated against provider ground truth
  before it ships.

## Cadence
Autonomous build loop: pick the highest-ranked ready item → design → implement + test → PR →
verify CI → merge → deploy → live-verify → update this doc + FINDINGS → repeat.
