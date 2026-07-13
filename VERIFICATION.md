# VERIFICATION — fix/vector-multiday-replay (15-day history + multi-day replay)

Branch scope: seed the Vector chart with **15 trading sessions** of bars + wall/bead rail and make
replay scrub honestly across session boundaries. Reviewed at the 2026-07-14 morning checkpoint —
**not merged, not deployed** from this branch.

## What was tested locally (all green at push time)

- `npx tsc --noEmit` — clean.
- `npx tsx --test src/features/vector/lib/*.test.ts` — **401/401 pass**, including the new cases:
  - `vector-wall-history.test.ts` (+10): `decimateWallHistory` keeps the LAST sample per 2-min
    bucket (wall deaths survive), preserves `modeled` flags + original times, slims ladders to
    top-N by |pct| in recorded order, and lands a 1560-sample session at exactly 195 samples;
    `latestSessionSlice` isolates the newest session; `isRebirthGap` fires intraday but NOT on an
    overnight/session gap; `trailsByStrike` dominance applies per bucket independently across two
    sessions and never bridges the overnight gap; `bucketWallHistoryForInterval` keeps sessions in
    distinct buckets; `backfillRailPrefix` measures the prefix gap against the LATEST session
    window (multi-day observed rail) and never underlays modeled ghosts beneath a prior session.
  - `vector-replay.test.ts` (+3): with a 2-session history/bars set, a cursor in session 1 shows
    ONLY session-1 walls/bars/flip (`sliceHistoryToTime`/`sliceBarsToTime`/`wallsAtReplayTime`);
    a cursor in session 2 reads session-2 structure; the timeline is the sorted union across both
    sessions with no fabricated overnight steps.
  - `vector-wall-events.test.ts` (+1): `eventsFromWallHistory` emits ZERO events across a
    session-sized gap (no fabricated "wall shifted overnight" burst at the 14 seed boundaries).
  - `vector-wall-persist.test.ts` (+4): `loadMultiSessionWallHistory` concatenates per-session
    rails time-ascending regardless of input session order, treats unrecorded sessions as honest
    gaps, and reads the composite per-horizon keys correctly.
  - `vector-seed-bars.test.ts` (+5): 15 sessions by default with `sessionYmds` ascending and
    `latestSessionStartSec` exposed; newest 3 sessions stay 1m while older decimate to 5m;
    `targetSessions=3` reproduces the pre-multi-day seed byte-for-byte (all 1m); the 6500-bar
    ceiling drops whole OLDEST sessions and never the latest; empty-everywhere returns an empty,
    well-formed result.
- `npm run build` — completes.

## Payload measurement (synthetic, SPX-shaped, both lenses — script re-runnable)

| slice | raw JSON | gzip |
| --- | --- | --- |
| bars 3×390 (1m) + 12×78 (5m), with volume | ~196 KB | ~45 KB |
| counterfactual: 15 sessions all-1m bars | ~546 KB | ~123 KB |
| latest-session rail, full-res 15s × 20/side (pre-existing) | ~3.5 MB | ~534 KB |
| 14 prior sessions, UNdecimated (counterfactual) | ~49 MB | ~7.5 MB |
| 14 prior sessions @ 2-min step, 8/side | ~2.7 MB | ~408 KB |
| **14 prior sessions @ 2-min step, 6/side (shipped)** | **~2.1 MB** | **~320 KB** |

Decisions this drove (documented in code):
- Prior-session BARS decimate to 5m (bars alone would have been ~546 KB raw at 1m; now ~196 KB).
- Prior-session RAIL decimates to the 2-min step and slims ladders to 6/side. The slim is
  render-lossless for prior days: every consumer of a non-latest sample reads at most the top 3
  per side (bead dominance filter = 3, crosshair legend `.slice(0,3)`, replay banner kings `[0]`),
  and top-3 of a 6-deep slim ≡ top-3 of the full 20-deep ladder.
- Total sample budget: 14×195 + 1560 ≈ **4290 samples ≤ ~4800 cap** (MAX_HISTORY raised
  1920 → 4800; trims OLDEST first so a live day never evicts today's tail).
- The dominant remaining cost (~534 KB gz) is the **pre-existing** full-res latest-session rail,
  unchanged by this branch.

## Blast-radius containment (verified by reading every caller)

- `/api/market/vector/bars` and `computeServerTechnicals` pin `targetSessions=3` — byte-identical
  output to before (3 sessions, all 1m). Reconnect backfill therefore cannot union 1m rows over
  the SSR seed's 5m prior days, indicator math sees no 5m closes, and neither path pays 15
  Polygon calls per request.
- Seed fetches now run in PARALLEL batches (candidate trading days precomputed via
  `previousTradingDayEt`) so 15-session SSR costs ~1 round-trip of latency, not 15 sequential.
- `vector-snapshot.ts` session-reset (live in-memory rail honesty) untouched.
- Session-gap guards added where the multi-day rail would otherwise fabricate intraday change:
  `eventsFromWallHistory`, the client SSE tail-diff, bead REBIRTH cues (`isRebirthGap`), and wall
  integrity persistence (`latestSessionSlice`).

## MUST verify live post-deploy (needs real prod data — not possible pre-merge)

1. **Multi-day rail renders**: open /vector (SPX + one stock, e.g. NVDA) — chart shows ~15
   sessions of candles; bead rail spans the days the recorder actually observed (older days may
   honestly be sparse/absent where `vector_wall_history` has no rows — check row counts per
   session_ymd if the rail looks thin).
2. **Replay across days**: enter replay, scrub from day 1 → today. Walls/flip/banner at a cursor
   inside day N must show day-N structure only (no future leakage); the overnight boundary shows
   no "wall shifted" event burst and no rebirth-boosted beads at each day-open.
3. **SSR payload + latency**: measure the real page-document size (gzip) and TTFB against the
   table above; confirm Polygon per-day fetches (15 parallel) don't rate-limit.
4. **DB batch read**: first cold load beyond the 72h Redis window hits
   `loadSessionsWallHistoryFromDb` (one `session_ymd = ANY($2)` query) — check pg logs/latency,
   and that Redis re-warms (second load fast).
5. **Wall events ticker + integrity note**: on open, no overnight fabrication; integrity says
   "held N% of session" scored against TODAY only.
6. **Hardcore/staging gates**: `npm run validate:vector-push-gate` and
   `npm run validate:vector-hardcore` (replay frame count should INCREASE with the multi-day
   timeline; assert start≠end still holds).
