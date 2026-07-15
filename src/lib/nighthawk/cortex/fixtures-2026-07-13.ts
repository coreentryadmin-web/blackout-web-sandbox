// CORTEX FIXTURES — the 2026-07-13 session snapshots the design doc requires (§4
// PR-A: "tests with fixture snapshots per source (including a 7/13 QQQ-short fixture
// that must come out net-supportive and a SPY-long fixture that must veto)").
//
// Shaped after the real 7/13 ledger (NIGHTHAWK-VS-SLAYER-0DTE.md §2.2): QQQ short
// flagged 10:20 ET was the session's one winner (+76.6%) on an aligned down tape;
// SPY long flagged 9:55 ET died at the stop — counter-tape, opening window, into a
// call wall, against $1M+ of opposing sweep flow. Prices use the 7/13 desk scale
// (SPX ≈ 7512 → SPY ≈ 751; QQQ ≈ 612).
//
// Lives in a plain .ts file (not inside a .test.ts) on purpose: tsconfig.json
// excludes **/*.test.ts from `npx tsc --noEmit`, so typing the fixtures here gives
// them a real compile-time net against CortexInputs drift — the same rationale as
// src/lib/bie/spx-full-state-fixture.ts.

import type { CortexInputs, CortexOpeningBar, CortexWallTrendSample } from "./types";

function epochSec(iso: string): number {
  return Date.parse(iso) / 1000;
}

/** 15 opening minute bars (9:30–9:45 ET = 13:30–13:45 UTC on 2026-07-13, EDT),
 *  drifting from `open` to `last` with a small per-bar wobble. */
function openingBars(startIso: string, open: number, last: number): CortexOpeningBar[] {
  const t0 = epochSec(startIso);
  const bars: CortexOpeningBar[] = [];
  const step = (last - open) / 14;
  for (let i = 0; i < 15; i++) {
    const o = open + step * i;
    const c = open + step * (i + 1);
    bars.push({
      time: t0 + i * 60,
      open: Number(o.toFixed(2)),
      close: Number(c.toFixed(2)),
      high: Number((Math.max(o, c) + 0.2).toFixed(2)),
      low: Number((Math.min(o, c) - 0.2).toFixed(2)),
    });
  }
  // Pin the endpoints exactly (float steps drift): the classifier reads bars[0].open
  // and the last close.
  bars[0].open = open;
  bars[14].close = last;
  return bars;
}

// ---------------------------------------------------------------------------
// QQQ SHORT, flagged 10:20 ET (14:20 UTC) — must compose NET-SUPPORTIVE, no vetoes.
// ---------------------------------------------------------------------------

/** 12 rail samples, 13:35→14:19 UTC (44 min, 4-min cadence): the opposing put wall
 *  606 FADES 24% → 13% (path clearing for a short) while the king node migrates
 *  615 → 613 (downward, toward the short target). */
function qqqShortRail(): CortexWallTrendSample[] {
  const t0 = epochSec("2026-07-13T13:35:00Z");
  const samples: CortexWallTrendSample[] = [];
  for (let i = 0; i < 12; i++) {
    samples.push({
      time: t0 + i * 240,
      callWalls: [
        // 615 dims slightly; 613 builds into the dominant call node — by the last
        // sample the overall king is 613 (was 615), a downward migration.
        { strike: 615, pct: 26 - i * 0.3 },
        { strike: 613, pct: 20 + i * 0.68 },
      ],
      putWalls: [
        { strike: 606, pct: 24 - i }, // 24 → 13: the fading opposing wall
        { strike: 604, pct: 8 },
      ],
    });
  }
  return samples;
}

export const QQQ_SHORT_2026_07_13: CortexInputs = {
  ticker: "QQQ",
  direction: "short",
  now: "2026-07-13T14:20:00.000Z", // 10:20 ET — the real flag time of the 7/13 winner
  spot: 612.4,
  expectedMovePts: 4.8,
  gex: {
    asOf: "2026-07-13T14:18:00.000Z",
    spot: 612.4,
    // Dominant call wall 613 sits 0.6 pts ABOVE spot (≤0.25×EM = 1.2): a short
    // entering off same-side resistance. Dominant put wall 606 is 6.4 pts below —
    // OUTSIDE 0.5×EM (2.4), so the target path is clear (no wallPathCheck veto).
    callWalls: [
      { strike: 613, pct: 21.5 },
      { strike: 615, pct: 12.2 },
    ],
    putWalls: [
      { strike: 606, pct: 16.8 },
      { strike: 604, pct: 9.1 },
    ],
    gammaFlip: 616.5, // spot below flip → short-gamma trending tape: momentum style fits
    regimePosture: "short",
  },
  wallTrend: { asOf: "2026-07-13T14:19:00.000Z", samples: qqqShortRail() },
  flow: {
    asOf: "2026-07-13T14:19:00.000Z",
    prints: [
      // Aligned bearish sweep cluster: 3 sweeps, $1.25M inside the 15-min window.
      { premium: 450_000, direction: "bearish", kind: "sweep", at: "2026-07-13T14:08:00.000Z" },
      { premium: 380_000, direction: "bearish", kind: "sweep", at: "2026-07-13T14:13:00.000Z" },
      { premium: 420_000, direction: "bearish", kind: "sweep", at: "2026-07-13T14:18:00.000Z" },
      // Opposing bullish tape is sub-veto: one small sweep + one non-urgent print.
      { premium: 200_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:10:00.000Z" },
      { premium: 300_000, direction: "bullish", kind: "other", at: "2026-07-13T14:12:00.000Z" },
    ],
  },
  sector: {
    asOf: "2026-07-13T14:15:00.000Z",
    sectorName: null,
    sectorChangePct: null,
    breadthTone: "negative", // 7/13 sold off all day — the room supports a short
    tickerChangePct: -0.9,
  },
  news: {
    asOf: "2026-07-13T14:20:00.000Z",
    items: [], // no market catalyst behind the move — flow is uncatalyzed (absent, not fabricated)
    earningsToday: null,
  },
  vex: {
    asOf: "2026-07-13T14:18:00.000Z",
    netVex: -820_000_000, // negative: vol-up forces dealer selling — aligned with a short
    kingStrike: 613,
  },
  darkPool: {
    asOf: "2026-07-13T14:18:00.000Z",
    // 613.2 sits 0.2 pts from the supporting 613 call wall (inside 0.1×EM = 0.48).
    levels: [{ price: 613.2, premium: 42_000_000 }],
  },
  opening: {
    asOf: "2026-07-13T14:20:00.000Z",
    // Gap DOWN 3.2 pts (0.67× EM) off prior close 618.2, extending lower through the
    // window (615.0 → 613.8): gap-and-go bearish — the 7/13 opening character that
    // made the QQQ short the aligned play. Internals confirm (both negative).
    bars: openingBars("2026-07-13T13:30:00Z", 615.0, 613.8),
    priorClose: 618.2,
    tick: -520,
    add: -1400,
  },
  errors: {},
};

// ---------------------------------------------------------------------------
// SPY LONG, flagged 9:55 ET (13:55 UTC) on the down tape — must VETO.
// ---------------------------------------------------------------------------

/** 11 rail samples, 13:14→13:54 UTC: the opposing call wall 753 BUILDS 12% → 22%
 *  (path hardening for a long); the king node (put 748) does not migrate. */
function spyLongRail(): CortexWallTrendSample[] {
  const t0 = epochSec("2026-07-13T13:14:00Z");
  const samples: CortexWallTrendSample[] = [];
  for (let i = 0; i < 11; i++) {
    samples.push({
      time: t0 + i * 240,
      callWalls: [{ strike: 753, pct: 12 + i }], // 12 → 22: building into the long's path
      putWalls: [{ strike: 748, pct: 25 }], // stable king — no migration signal
    });
  }
  return samples;
}

export const SPY_LONG_2026_07_13: CortexInputs = {
  ticker: "SPY",
  direction: "long",
  now: "2026-07-13T13:55:00.000Z", // 9:55 ET — the real flag time of the 7/13 SPY long (−52.7%)
  spot: 751.2,
  expectedMovePts: 3.9,
  gex: {
    asOf: "2026-07-13T13:53:00.000Z",
    spot: 751.2,
    // Dominant call wall 753 is 1.8 pts above spot — INSIDE 0.5×EM (1.95): the long
    // target path runs straight into the sell-hedging zone → wallPathCheck veto.
    callWalls: [
      { strike: 753, pct: 24.6 },
      { strike: 755, pct: 11 },
    ],
    putWalls: [
      { strike: 748, pct: 18 }, // 3.2 pts below — outside 0.25×EM (0.98): no support either
      { strike: 745, pct: 9 },
    ],
    gammaFlip: 754.8, // spot below flip: short-gamma trend tape (trending DOWN on 7/13)
    regimePosture: "short",
  },
  wallTrend: { asOf: "2026-07-13T13:54:00.000Z", samples: spyLongRail() },
  flow: {
    asOf: "2026-07-13T13:54:00.000Z",
    prints: [
      // Opposing bearish sweep cluster: $1.15M across 2 prints inside 15 min → veto.
      { premium: 600_000, direction: "bearish", kind: "sweep", at: "2026-07-13T13:47:00.000Z" },
      { premium: 550_000, direction: "bearish", kind: "sweep", at: "2026-07-13T13:50:00.000Z" },
      // The aligned bullish tape the scanner chased: one sweep, sub-cluster.
      { premium: 400_000, direction: "bullish", kind: "sweep", at: "2026-07-13T13:49:00.000Z" },
    ],
  },
  sector: {
    asOf: "2026-07-13T13:50:00.000Z",
    sectorName: null,
    sectorChangePct: null,
    breadthTone: "strongly_negative", // the 7/13 open: everything red
    tickerChangePct: -0.5,
  },
  news: {
    asOf: "2026-07-13T13:55:00.000Z",
    items: [],
    earningsToday: null,
  },
  vex: {
    asOf: "2026-07-13T13:53:00.000Z",
    netVex: -1_100_000_000, // vol spiking on the sell-off — fights a long
    kingStrike: 750,
  },
  darkPool: {
    asOf: "2026-07-13T13:53:00.000Z",
    levels: [{ price: 749.8, premium: 30_000_000 }], // no supporting wall to confirm → bonus stays absent
  },
  opening: {
    asOf: "2026-07-13T13:55:00.000Z",
    // Gap DOWN 2.7 pts (0.69× EM) off prior close 754.6, extending lower 751.9 →
    // 751.0: gap-and-go BEARISH character at 9:55 — it FIGHTS the long (oppose),
    // on top of the two vetoes. Internals deep red.
    bars: openingBars("2026-07-13T13:30:00Z", 751.9, 751.0),
    priorClose: 754.6,
    tick: -650,
    add: -1600,
  },
  errors: {},
};
