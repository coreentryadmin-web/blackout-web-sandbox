# Vector — Deep Sweep, CTO Assessment & World-Class Roadmap (2026-07-11)

**Author:** Claude (owning the Vector product end-to-end this session)
**Method:** 5 parallel adversarial code-audit agents over the full Vector surface (~5.5k LOC: chart/replay, wall pipeline, SSE/data path, UI/access, cross-cutting/persistence) + a live signed-in staging UI audit (temp Cognito admin, desktop 1680×1000 + mobile 390×844, replay/lens/timeframe exercised, console + network captured).
**Scope note:** the user granted full authority to fix Vector directly; this doc is the record + the forward plan, not a handoff.

---

## 1. Executive summary

**Where Vector was:** a genuinely strong *architecture* (per-ticker SSE fan-out hub, honest replay-slicing primitives, shared GEX math, no duplicated provider logic) carrying a **dangerous layer of data-integrity bugs** — several of the repo's recurring "stale/absent value masquerading as current" shape, one of them a re-occurrence of a bug fixed four days earlier through a new code path. On top of that, the product's signature surface — the live chart — was **not even visible above the fold**, and staging had been serving a **broken build** (chunk 404s → error boundary) for hours because of an unrelated CSS breakage on the shared branch.

**What changed this session:** the build is fixed and guarded against recurrence; the page loads clean (0 console errors, 0 failed requests, verified live); and **six correctness batches** closed every Critical/High/Medium finding plus the two previously-deferred follow-ups. Vector is now *correct*. The remaining work is *presentation* — turning a correct tool into a world-class one.

**CTO verdict:** the foundation is now genuinely strong — the data is honest, the stream scales, replay is faithful. The product is one focused design pass away from top-tier. The gap is layout priority and visual system, not capability.

---

## 2. What was fixed (six merged batches)

| PR | Batch | Headline |
|----|-------|----------|
| #126 | Replay integrity | **P0** — the 2026-07-07 future-bar leak re-entered via the SPY-volume backfill effect (repaints full live bars during replay); replay dropped live bars permanently; lens/DP frame desyncs. SSE now stays open through replay, only paints are cursor-gated. |
| #127 | Ticker remount | Ticker switch showed the old ticker's chart/stream under the new ticker's header (found by 2 agents independently) — `key={activeTicker}` remount; desk-terminal error now surfaced. |
| #129 | Wall-event integrity | Phantom "flip moved 6,745→6,745" every page load (raw-float compare + mixed-precision history); SHIFT flapping; fabricated breaks from a wall crossing a flat spot; cross-session weekend stitching; replay-blind structure feed. |
| #131 | Data freshness | Dark pool absent ~85% of RTH (90s TTL vs 10-min cron); ~60 full-day Polygon fetches/min (no negative cache); stale fallbacks stamped fresh; UW cache key ignored `min_premium` opts (dead filter + cross-poisoning). |
| #134 | Stream scale | ~1MB/s per connection (full wall-history every frame) → full-once-then-delta; junk-ticker 1Hz Polygon amplification → universe allowlist; lossy per-ticker persist; reconnect bar holes → `/vector/bars` backfill. |
| #135 | Misc hygiene | Universe knife-edge TTL + inline-rebuild storm; late-tick forming-bar corruption; DJI dead mapping; NaN OHLC passthrough; cron pile-up stagger; freshness-timestamp honesty. |

Plus #122/#133: repaired the shared-branch build breakage (invalid Tailwind `@apply` opacity — **4th occurrence** of this class) and added a permanent `verify` guard (`check-tailwind-apply-opacity.mjs`) so the introducing PR now fails CI instead of silently blocking every deploy.

**Security:** full route-auth trace across every `/api/market/vector/*` and `/api/cron/vector-*` endpoint — all server-gated, the prior launch-gate P1 stays fixed, no secret leakage, no client-only checks. Clean bill.

**Test coverage added:** replay slice-then-aggregate, 9 wall-event regressions (near-tie vs dominant shift, flat-spot break, precision phantom, cross-session), SPY-volume negative-cache, `mergeBarsByTime`, out-of-order candle guard. Vector lib suite 85→96 tests, all green.

---

## 3. Strengths (keep these)

- **SSE hub architecture** — one payload build per ticker per second shared across all connections, `refreshInFlight` dedup, clean teardown on last detach. Textbook.
- **Replay slicing primitives** (`vector-replay.ts`) — `sliceBarsToTime`/`wallsAtReplayTime` are strict and honest; the bugs were always call sites bypassing them, never the primitives.
- **Replay transport UX** — Live/step/Open/Close/Loop/speed + scrub with `9:30:00 AM · 1/395` frame counter is genuinely well-built and reads like a pro terminal.
- **No duplicated market math** — Vector reuses shared `computeGexWalls`/`getGexPositioning`/`fetchGexHeatmap`; no gamma/EMA reimplementation.
- **Error isolation** — every provider lane in the payload build catches and degrades; one failure can't kill the stream.

---

## 4. Weaknesses & gaps that remain (the polish agenda)

Ranked by product impact. These are **presentation**, now that correctness is closed.

### P0 — Layout priority is inverted (the product is below the fold)
`/vector` is billed "LIVE SPX CHART," but on load the entire above-the-fold viewport is the **21-row universe scanner table**; the chart, toolbar, lens toggle, and desk terminal are crammed at the very bottom edge and the chart is almost entirely below the fold. A member has to scroll past a data table to reach the tool they came for. **The chart must be the hero.** The scanner belongs in a compact, collapsible left rail or a top strip — glanceable, not dominant.

### P1 — Scanner table is visually undifferentiated
Plain monospace rows, tiny cyan headers, no encoding of the one thing that matters: **where spot sits relative to gamma flip and the walls.** No above/below-flip color, no wall-proximity heat, no sort, no row emphasis for the active ticker. It's a database dump, not a scanner.

### P1 — Off-hours chart reads as broken
Off-hours the chart is a large black void with only floating yellow wall labels and a price line — no candles visible, no clear "session closed, showing last-close structure — hit Replay to review the day" affordance. The data exists (replay shows 395 frames); the empty state just doesn't communicate.

### P2 — Chart visual system is not yet a designed palette
Wall labels are heavy solid-yellow chips; all overlays compete at the same visual weight; the GEX/VEX lens colors were never validated for colorblind separation (dark-pool cyan `#00d4ff` vs gamma-flip cyan `#22d3ee` fail CVD separation — worst adjacent ΔE 6.9). Dark-pool needs a distinct hue (validated: orange `#ff8a3d` lifts worst-pair ΔE to 36.7).

### P2 — Onboarding overlay blocks the whole tool on first visit
The "Quick Tour / Options 101" modal intercepts every click on first load with no obvious dismiss priority — fine as a feature, but it shouldn't be the first and only interaction.

### P3 — Freshness/label polish
"LIVE SPX CHART" kicker shows over a "JUL 10 CLOSE" badge off-hours (mildly contradictory); IV-rank and a couple of pills still render raw where siblings round.

---

## 5. World-class roadmap (enhancement proposals)

Beyond fixing the above, what would make Vector *best-in-class* for a dealer-positioning chart:

1. **Chart-hero layout** with a collapsible scanner rail + a compact "structure ribbon" above the chart (spot vs flip, nearest call/put wall, distance-to-wall %, regime) — the at-a-glance read a trader wants before looking at candles.
2. **Wall-proximity intelligence** — color/opacity of each wall guide scaled by |spot − wall| and concentration; a subtle "approaching wall" pulse when spot comes within N points. (The data — pct concentration — already flows; it's under-used visually.)
3. **Regime banner** — above/below gamma flip drives the whole day's character; make it a first-class, always-visible state (supportive/hedging vs momentum/vol-expansion), colored, with the flip level.
4. **Replay as a teaching tool** — "jump to first wall break," "jump to flip cross" buttons (the events already exist in the structure feed); scrub-to-event.
5. **Scanner as a real screener** — sortable, filterable (near-flip, wall-pinned, widest walls), sparkline per ticker, click-to-load with the fixed remount.
6. **Multi-timeframe wall persistence view** — the wall-history trails already exist; surface them as an optional "structure migration" overlay showing how walls moved through the session.
7. **Accessibility + theme rigor** — validated categorical palette (run the dataviz validator on the final overlay set), legend always present, direct labels, a table view of the structure for screen readers.

---

## 6. Live staging verification (this pass)

- Deploy `4cd0a73e` (repaired build) confirmed `COMPLETED` on ECS, 3 tasks running.
- Signed-in `/vector` load: **0 console errors, 0 failed requests** (was 15 errors / 8 chunk-404s pre-fix).
- Replay: entered, scrubbed to 50% (`9:30:00 AM · 1/395`), exited — no leak, transport responsive.
- Lens GEX↔VEX toggle: works.
- Mobile 390×844: no horizontal overflow (`bodyW === winW === 390`).
- Screenshots: `scratchpad/vector-ui-audit/10-19*.png`.

**Bottom line:** correctness is done and verified live. The next commits are the design pass in §4–§5 — chart-hero layout, scanner upgrade, validated palette, off-hours state — each verified on staging the same way.
