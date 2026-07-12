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
  horizon the member trades, on-demand so the shared stream stays fast. **Extended to EVERY ticker
  (2026-07-12):** was oracle-only (SPX/SPY/QQQ, which carry the UW per-expiry WS ladder); now the
  Polygon options chain (per-contract expiry+OI+IV, Redis-cached ~10min) is filtered per horizon and
  the GEX ladder recomputed at spot (same BSM math as the reconstruction engine), so 0DTE/weekly/
  monthly walls **and** the gamma flip re-scope on any optionable name — the toggle is un-hidden and
  real everywhere, with an honest blended fallback so walls never blank.
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
- **Skylit visual pass** *(2026-07-12, #172/#173/#174)* — member-driven, with Skylit Atlas
  references: (1) bead **thickness now scales with wall strength** relative to the strongest wall
  in view (per side), so a dominant wall is a fat band and stragglers are thin — and a band bulges
  thicker over the session as the wall builds (#172); (2) **clean price axis** — wall + dark-pool
  guide labels/lines removed, walls shown ONLY as beads, a single dashed gamma-flip line, and
  right-edge whitespace so bands stop short of the axis (#173); (3) the **nearest put wall is
  always pulled into view** (up to a 12% cap) so purple put beads render, not just yellow calls —
  they were being clipped when the nearest put sat just past the old ±5% window (#174). Remaining:
  purple reads faint OFF-HOURS (dimmed modeled underlay + lower purple luminance) — solid in live
  RTH; server recording still covers only the ~21 universe tickers (record-any-viewed-ticker is
  the next RTH-parity gap); GEX magnitude ground-truth cross-check still owed before "100% correct."
- **Timeframe-scaled walls** *(2026-07-12, #169)* — the wall guides + beads showed a fixed 6
  near-spot walls at every zoom; now the server returns up to 12 per side and the client shows
  more, further-out walls as the candle timeframe widens (`1m→6, 3m→8, 5m→10, ≥15m→12`), with the
  autoscale range keyed to the shown-count so 1m stays tight and 15m reveals the outer structure.
- **Terminal follows the DTE horizon** *(2026-07-12, #170)* — the desk terminal + regime banner
  read the near-term stream even when the member narrowed to 0DTE/weekly/monthly, so the narration
  ("magnet 210 · 198P · flip 197.65") could describe a *different scope* than the walls on the
  chart (0DTE 190 put, 195.2 flip). Now regime/magnet/proximity/integrity all read the horizon-
  scoped `liveGexWalls()`/`liveGammaFlip()` and re-derive on toggle, via a pure tested
  `pickHorizonScopedValue` — the terminal and the chart can no longer disagree about scope.
- **Durable wall-history storage** *(2026-07-12)* — the rail was Redis-only (48h TTL): nothing
  survived a Redis restart or older than ~2 days. Now **write-through to Postgres** — the recorder
  fans each 15s/5min bucket to both Redis (hot cache, unchanged) and a `vector_wall_history` table
  (durable). Reads are **Redis-first with a Postgres fallback** that re-warms the cache; **90-day
  retention** pruned by the db-cleanup cron. This makes "the beads reliably persist and never
  silently vanish" a structural guarantee — the class of failure behind the Jul 10 blank rail — and
  gives replay ~3 months of history + a durable base for the strike×time heatmap (#14).

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
  staleness, show honest gaps. The bead rail distinguishes **observed** from **modeled** and never
  blurs them: recorded point-in-time samples render solid; the reconstructed session (modeled from
  the EOD chain along the real spot path) renders as a **dim, labeled "modeled" underlay** that the
  observed samples overwrite wherever they exist (modeled-underlay decision, 2026-07-12, user-
  approved — see `mergeModeledUnderlay`). This gives an instant full-day trail for any ticker while
  keeping modeled ≠ observed visible (dim/ghosted + a "modeled vs recorded" legend) — the opposite
  of the #160 bug, where reconstruction was injected into the rail *presented as observed*. Model
  where labeled (this underlay + the strike×time heatmap #14); observed everywhere else.
- **Small, tested, verified PRs** — one concept per PR, `tsc`+tests+`@apply` guard green, live-
  verified on staging where there's a runtime surface.
- **Keep the stream fast** — new interpretation layers are on-demand or client-derived; never bloat
  the shared per-second SSE fan-out.
- **Correctness is a feature** — every analytical layer is validated against provider ground truth
  before it ships.

## Cadence
Autonomous build loop: pick the highest-ranked ready item → design → implement + test → PR →
verify CI → merge → deploy → live-verify → update this doc + FINDINGS → repeat.
