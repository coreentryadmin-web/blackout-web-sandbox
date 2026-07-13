import type { VectorFullState } from "@/lib/bie/vector-full-state";

// Deliberately a plain `.ts` file, NOT `.test.ts` — tsconfig.json excludes
// "**/*.test.ts" from `npx tsc --noEmit`, so a fixture typed only inside a
// *.test.ts file gets zero real compile-time enforcement (tsx/esbuild strips
// types without checking them, and the type-check command never looks at test
// files). Putting the literal here makes it a normal source file covered by the
// tsconfig include, so `tsc --noEmit` type-checks it against the live
// VectorFullState (and therefore the canonical VectorSnapshot) on every run.
//
// VECTOR_FULL_STATE_FIXTURE models EVERY field of VectorFullState with a fully
// valid, realistic value for each nested union (GexWalls, GammaMagnet,
// WallProximity, ExpectedMove, ConfluenceZone, WallIntegrity, PlayTechnicals,
// VectorPlay, VectorFlowMarkers, GexLadder, VectorHeatmapSummary) — not just outer
// field names. Both excess and missing properties are compile errors on a
// `const x: T = {...}` literal, so adding, removing, or retyping a field on
// VectorFullState / VectorSnapshot breaks this file's build until it is updated
// here — mirroring spx-full-state-fixture.ts's guard for SpxPlayPayload.
//
// Task #36 (Vector → BIE full-state pipeline).
export const VECTOR_FULL_STATE_FIXTURE: VectorFullState = {
  ticker: "SPX",
  horizon: "0dte",
  timeframeMin: 5,
  spot: 7560,
  regime: { posture: "long" },
  gexWalls: {
    callWalls: [
      { strike: 7600, pct: 8 },
      { strike: 7650, pct: 4 },
    ],
    putWalls: [
      { strike: 7500, pct: 7 },
      { strike: 7450, pct: 3 },
    ],
  },
  gammaFlip: 7520,
  magnet: {
    strike: 7555.5,
    distancePct: -0.0006,
    pull: "at",
    posture: "long",
    callout: "gamma magnet 7556 — spot pinned at the dealer-hedging center of mass",
  },
  proximity: {
    strike: 7600,
    side: "call",
    distancePct: 0.53,
    nearness: "testing",
    callout: "Testing 7,600 call wall (0.53% below) — dealers sell into strength; resistance unless it breaks on volume.",
  },
  expectedMove: {
    atmIv: 0.14,
    dteDays: 1,
    spot: 7560,
    movePct: 0.0073,
    bands: [
      { sigma: 1, low: 7505, high: 7615, movePts: 55 },
      { sigma: 2, low: 7450, high: 7670, movePts: 110 },
    ],
  },
  maxPain: 7550,
  confluenceZones: [
    {
      center: 7550.5,
      low: 7550,
      high: 7551,
      score: 5,
      kinds: ["max-pain", "put-wall"],
      levels: [
        { price: 7550, kind: "max-pain" },
        { price: 7551, kind: "put-wall", label: "755P wall", weight: 3 },
      ],
    },
  ],
  wallIntegrity: {
    call: {
      strike: 7600,
      side: "call",
      score: 78,
      tier: "firm",
      factors: { strength: 0.9, persistence: 0.72, isolation: 0.55 },
      note: "7600C firm — held 72% of session, dominant",
    },
    put: {
      strike: 7500,
      side: "put",
      score: 61,
      tier: "moderate",
      factors: { strength: 0.7, persistence: 0.5, isolation: 0.4 },
      note: "7500P moderate — held 50% of session, clustered",
    },
  },
  technicals: {
    vwap: 7558,
    emaStack: "mixed",
    rsi: 52,
    macd: "bull",
    goldenPocket: { low: 7540, high: 7548 },
    structure: { type: "BOS", direction: "up", level: 7562 },
  },
  bie: { favPct: 0.58, samples: 41, windowDays: 30 },
  dataAgeMs: 1200,
  play: {
    style: "scalp",
    bias: "short",
    conviction: 68,
    grade: "B",
    headline: "SCALP · fade the 7,600 call wall — short back toward VWAP 7,558",
    thesis:
      "Long gamma (spot 7,560 > flip 7,520): dealers sell strength, so the 7,600 call wall caps. Fade the test for a mean-revert lower.",
    entryZone: "short into 7,600 call wall",
    targets: ["VWAP/magnet 7,558", "max pain 7,550", "put wall 7,500"],
    invalidation: "5m close > 7,600 (wall breaks → fade void)",
    starred: [
      "SCALP · fade the 7,600 call wall — short back toward VWAP 7,558",
      "7600 call wall testing — dealers sell into strength; resistance unless it breaks on volume.",
      "BIE · setups like this resolved 58% fav over 41 · 30d",
    ],
    dataAge: 1200,
  },
  asOf: "2026-07-13T14:40:00.000Z",
  flow: {
    available: true,
    expiry: "2026-07-13",
    spot: 7560,
    prints: [
      { strike: 7600, side: "call", premium: 1_250_000, size: 400, tsMs: 1_752_417_600_000, aggressor: "buy" },
      { strike: 7500, side: "put", premium: 820_000, size: 260, tsMs: 1_752_417_500_000, aggressor: "sell" },
    ],
    meta: { minPremium: 250_000, largeFound: 5, truncated: 3, partial: false },
  },
  ladder: {
    spot: 7560,
    maxAbs: 4_200_000_000,
    rows: [
      { strike: 7650, gex: 1_100_000_000, side: "call", magnitude: 0.26, isKing: false },
      { strike: 7600, gex: 4_200_000_000, side: "call", magnitude: 1, isKing: true },
      { strike: 7500, gex: -3_800_000_000, side: "put", magnitude: 0.9, isKing: true },
      { strike: 7450, gex: -900_000_000, side: "put", magnitude: 0.21, isKing: false },
    ],
  },
  heatmap: { available: true, strikeCount: 24, timeCount: 78, maxAbs: 4_200_000_000 },
};
