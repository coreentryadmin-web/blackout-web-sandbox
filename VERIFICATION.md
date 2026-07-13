# VERIFICATION — fix/vector-surface-sync (chart · GEX ladder · terminal = one story)

Branch scope: a single client-side source of truth (`VectorHorizonSnapshot`) for every
narrated/displayed level, so the chart, the GEX ladder, and the desk terminal can never show
three different numbers. Reviewed at the 2026-07-14 morning checkpoint — **not merged, not
deployed** from this branch.

## What was tested locally (all green at push time)

- `npx tsc --noEmit` — clean; `npx eslint` on every changed file — clean.
- `npx tsx --test src/features/vector/lib/*.test.ts` — **384/384 pass**, including:
  - `vector-horizon-snapshot.test.ts` (new, 7 cases — the store's pure parts):
    - a fully-ok cycle swaps in ONE frozen snapshot with one `asOf`; mutation never lands
      (atomicity: no surface can ever read a half-updated snapshot);
    - ATOMIC SWAP under partial failure: if any of the four sub-fetches fails and the previous
      snapshot still matches the (ticker, horizon), the store returns the SAME previous
      reference — coherent old story, honest old `asOf` — never a mixed-instant patch;
    - partial failure with NO usable previous builds a coherent partial (all values from one
      cycle, failed parts null);
    - horizon/ticker switch INVALIDATION: a snapshot for (SPX, weekly) is never resurrected for
      (SPX, 0dte); `snapshotMatches` keys on both fields;
    - staleness boundary (`HORIZON_SNAPSHOT_STALE_MS`); ET clock formatting of the shared stamp.
  - `vector-dte-horizon.test.ts` (updated): `pickHorizonScopedValue` now prefers a non-null
    scoped value on **every** horizon including "all" — required because the scoped slot is now
    fed by the shared snapshot for all horizons; the old "all → always stream" short-circuit
    would have re-created the drift on exactly one horizon. Stream fallback when no snapshot
    yet is asserted.
- `npm run build` — completes.

## What changed (for the reviewer's mental model)

- **Before**: chart walls/flip fetched by VectorChart's DTE effect (own 15s interval), max-pain
  and expected-move fetched separately in the same effect, GEX ladder polled its own endpoint on
  its own 15s clock, terminal derived from chart refs — four cadences, independent failures,
  so surfaces routinely described different instants.
- **After**: `useVectorHorizonSnapshot(ticker, horizon, liveSession)` in the shell runs ONE
  cycle per 15s (RTH; once when closed): `Promise.all` of /walls, /gex-ladder, /max-pain,
  /expected-move with a single `asOf` stamp, swapped in atomically via the pure
  `nextHorizonSnapshot`. Chart (horizon walls/flip refs, max-pain line, cone, terminal emits),
  ladder (rows/spot), and terminal (asOf stamp) all consume this object. The chart's live SSE
  stream is untouched for candles/bead ticks and remains the fallback when no snapshot exists
  yet (`pickHorizonScopedValue` null-fallback, unchanged).
- The shared `asOf` renders on the ladder header ("· as of 2:32:15 PM") and as a terminal line
  ("levels as of 2:32:15 PM — synced with chart + ladder") so the sync is *visible*.
- Deliberately unchanged: VectorChart internals beyond consuming the snapshot (the existing
  refs are fed from it); the per-horizon recorded-trail fetch (wall-history) and the gex-heatmap
  surface fetch stay in the DTE effect (neither is a narrated level); replay paints (snapshot
  only updates refs during replay — frames draw exclusively from time-sliced history).

## MUST verify live post-deploy (needs the deployed build + RTH data)

1. **Identical numbers on all three surfaces**: during RTH, read the top call/put strike from
   (a) the GEX ladder king rows, (b) the chart banner/kings + flip line, (c) the terminal
   proximity/magnet/integrity citations — all three must match exactly at any instant, on SPX
   and at least one stock, across every DTE toggle (0DTE/WEEKLY/MONTHLY).
2. **Shared asOf stamp visible and in lockstep**: ladder header stamp == terminal stamp, and
   both advance together every ~15s in RTH (never independently).
3. **Failure coherence**: block one endpoint in devtools (e.g. /max-pain) — ALL surfaces must
   keep the previous cycle's numbers together (stamp stops advancing); nothing may mix old
   max-pain with new walls.
4. **Toggle re-scope**: DTE toggle still re-scopes ladder+walls+flip+max-pain+cone+terminal
   within one cycle; ticker switch never flashes the previous ticker's rows (snapshot key guard).
5. **Replay**: enter replay — cursor frames still draw historical walls (snapshot must not
   repaint live values over a replay frame); exit replay resumes on the current snapshot.
6. **Hardcore/staging gates**: `npm run validate:vector-push-gate` and
   `npm run validate:vector-hardcore` — the cross-surface checks (banner-vs-API coherence cases
   from the 2026-07-13 DTE grind) should now pass by construction; consider ADDING a hardcore
   case asserting ladder-row king == banner king == terminal citation (per the "keep growing it"
   policy) once this is deployed.
