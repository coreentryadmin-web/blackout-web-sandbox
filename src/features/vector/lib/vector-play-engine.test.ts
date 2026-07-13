import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVectorPlay, type VectorSnapshot } from "./vector-play-engine";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { GammaMagnet } from "./vector-gamma-magnet";
import type { WallProximity } from "./vector-wall-proximity";
import type { ExpectedMove } from "./vector-expected-move";
import type { ConfluenceZone } from "./vector-confluence";
import type { WallIntegrity } from "./vector-wall-integrity";

// ── Fixtures ────────────────────────────────────────────────────────────────
const walls: GexWalls = {
  callWalls: [
    { strike: 7600, pct: 8 },
    { strike: 7650, pct: 4 },
  ],
  putWalls: [
    { strike: 7500, pct: 7 },
    { strike: 7450, pct: 3 },
  ],
};

const em: ExpectedMove = {
  atmIv: 0.14,
  dteDays: 1,
  spot: 7560,
  movePct: 0.0073,
  bands: [
    { sigma: 1, low: 7505, high: 7615, movePts: 55 },
    { sigma: 2, low: 7450, high: 7670, movePts: 110 },
  ],
};

function magnet(strike: number, posture: GammaMagnet["posture"], pull: GammaMagnet["pull"]): GammaMagnet {
  return { strike, distancePct: 0.001, pull, posture, callout: `gamma magnet ${strike}` };
}

function proximity(side: WallProximity["side"], strike: number, nearness: WallProximity["nearness"]): WallProximity {
  return { strike, side, distancePct: 0.1, nearness, callout: `${side} wall ${strike} ${nearness}` };
}

function firmIntegrity(strike: number, side: "call" | "put"): WallIntegrity {
  return {
    strike,
    side,
    score: 82,
    tier: "firm",
    factors: { strength: 0.9, persistence: 0.8, isolation: 0.7 },
    note: `${strike}${side === "call" ? "C" : "P"} firm — held 80% of session, dominant`,
  };
}

function thinIntegrity(strike: number, side: "call" | "put"): WallIntegrity {
  return {
    strike,
    side,
    score: 30,
    tier: "thin",
    factors: { strength: 0.2, persistence: 0.2, isolation: 0.2 },
    note: `${strike}${side === "call" ? "C" : "P"} thin — held 20% of session, clustered`,
  };
}

function base(overrides: Partial<VectorSnapshot> = {}): VectorSnapshot {
  return {
    ticker: "SPX",
    horizon: "0dte",
    timeframeMin: 5,
    spot: 7560,
    regime: { posture: "long" },
    gexWalls: walls,
    gammaFlip: 7520,
    magnet: magnet(7555, "long", "down"),
    proximity: null,
    expectedMove: em,
    maxPain: 7550,
    confluenceZones: [],
    wallIntegrity: { call: null, put: null },
    technicals: { vwap: 7558, emaStack: "mixed", rsi: 52, macd: "bull", goldenPocket: null, structure: null },
    ...overrides,
  };
}

// ── Style by horizon ─────────────────────────────────────────────────────────
test("style: 0dte → SCALP, weekly → SWING, monthly/all → POSITION", () => {
  assert.equal(buildVectorPlay(base({ horizon: "0dte" }))!.style, "scalp");
  assert.equal(buildVectorPlay(base({ horizon: "weekly" }))!.style, "swing");
  assert.equal(buildVectorPlay(base({ horizon: "monthly", technicals: { emaStack: "up" } }))!.style, "position");
  assert.equal(buildVectorPlay(base({ horizon: "all", technicals: { emaStack: "up" } }))!.style, "position");
});

test("headline carries the style label in caps", () => {
  const scalp = buildVectorPlay(base({ horizon: "0dte", proximity: proximity("call", 7600, "at") }))!;
  assert.match(scalp.headline, /^SCALP/);
  const swing = buildVectorPlay(base({ horizon: "weekly", proximity: proximity("call", 7600, "at") }))!;
  assert.match(swing.headline, /^SWING/);
});

// ── Long-gamma pin fade (call wall) ──────────────────────────────────────────
test("long-gamma fade: at a call wall → short bias, fade headline, targets below, invalidation above the wall", () => {
  const play = buildVectorPlay(
    base({
      spot: 7598,
      proximity: proximity("call", 7600, "at"),
      wallIntegrity: { call: firmIntegrity(7600, "call"), put: null },
      confluenceZones: [
        { center: 7600, low: 7599, high: 7601, score: 8, kinds: ["call-wall", "max-pain"], levels: [] } as ConfluenceZone,
      ],
    })
  )!;
  assert.equal(play.bias, "short");
  assert.match(play.headline, /fade the 7,600 call wall/);
  assert.ok(play.targets.length > 0, "has downside targets");
  // Every target must sit below spot for a short fade.
  for (const t of play.targets) {
    const price = Number(t.match(/([\d,]+(?:\.\d+)?)\s*$/)![1].replace(/,/g, ""));
    assert.ok(price < 7598, `target ${t} should be below spot`);
  }
  assert.match(play.invalidation!, /close > 7,600/);
  // Firm wall + confluence at the level + at-wall proximity → A grade.
  assert.ok(play.conviction >= 75, `expected A-grade conviction, got ${play.conviction}`);
  assert.equal(play.grade, "A");
});

test("long-gamma fade: at a PUT wall → long bias, targets above, invalidation below", () => {
  const play = buildVectorPlay(
    base({
      spot: 7502,
      proximity: proximity("put", 7500, "at"),
      wallIntegrity: { call: null, put: firmIntegrity(7500, "put") },
      magnet: magnet(7555, "long", "up"),
    })
  )!;
  assert.equal(play.bias, "long");
  assert.match(play.headline, /fade the 7,500 put wall/);
  for (const t of play.targets) {
    const price = Number(t.match(/([\d,]+(?:\.\d+)?)\s*$/)![1].replace(/,/g, ""));
    assert.ok(price > 7502, `target ${t} should be above spot`);
  }
  assert.match(play.invalidation!, /close < 7,500/);
});

// ── Long-gamma open-space range ──────────────────────────────────────────────
test("long-gamma open space (no proximity) → range bias, mean-revert to magnet", () => {
  const play = buildVectorPlay(base({ spot: 7555, proximity: null, magnet: magnet(7555, "long", "at") }))!;
  assert.equal(play.bias, "range");
  assert.match(play.headline, /range/);
  assert.match(play.thesis, /pinned/);
  assert.match(play.invalidation!, /flips to short gamma/);
});

// ── Short-gamma breakout ─────────────────────────────────────────────────────
test("short-gamma breakout: breaking a put wall → momentum short, wider stop, targets below", () => {
  const play = buildVectorPlay(
    base({
      spot: 7502,
      regime: { posture: "short" },
      gammaFlip: 7600,
      proximity: proximity("put", 7500, "testing"),
      technicals: { emaStack: "down", macd: "bear" },
    })
  )!;
  assert.equal(play.bias, "short");
  assert.match(play.headline, /momentum short on a break of 7,500/);
  assert.match(play.thesis, /amplifies/);
  assert.match(play.invalidation!, /close back > 7,500/);
});

test("short-gamma breakout: breaking a call wall → momentum long", () => {
  const play = buildVectorPlay(
    base({
      spot: 7601,
      regime: { posture: "short" },
      gammaFlip: 7500,
      proximity: proximity("call", 7600, "testing"),
      technicals: { emaStack: "up", macd: "bull" },
    })
  )!;
  assert.equal(play.bias, "long");
  assert.match(play.headline, /momentum long on a break of 7,600/);
});

test("short-gamma no wall in range → follows the EMA trend", () => {
  const up = buildVectorPlay(
    base({ regime: { posture: "short" }, proximity: null, technicals: { emaStack: "up", macd: "bull" } })
  )!;
  assert.equal(up.bias, "long");
  const down = buildVectorPlay(
    base({ regime: { posture: "short" }, proximity: null, technicals: { emaStack: "down", macd: "bear" } })
  )!;
  assert.equal(down.bias, "short");
});

// ── Flip transition pivot ────────────────────────────────────────────────────
test("transition regime → pivot play at the flip, neutral bias, tight invalidation at the flip", () => {
  const play = buildVectorPlay(
    base({ spot: 7520, regime: { posture: "transition" }, gammaFlip: 7520, proximity: proximity("flip", 7520, "at") })
  )!;
  assert.equal(play.bias, "neutral");
  assert.match(play.headline, /pivot at the 7,520 gamma flip/);
  assert.match(play.invalidation!, /close back through 7,520/);
  // Pivot stars the imminent flip cross.
  assert.ok(play.starred.some((s) => /Flip cross imminent/.test(s)));
});

test("proximity to flip (even if posture labelled long) → pivot", () => {
  const play = buildVectorPlay(
    base({ spot: 7521, regime: { posture: "long" }, gammaFlip: 7520, proximity: proximity("flip", 7520, "testing") })
  )!;
  assert.match(play.headline, /pivot/);
});

// ── Position horizon trend ───────────────────────────────────────────────────
test("position horizon with stacked EMAs → trend play, not an intraday fade", () => {
  const longP = buildVectorPlay(
    base({ horizon: "monthly", regime: { posture: "long" }, proximity: proximity("call", 7600, "at"), technicals: { emaStack: "up", macd: "bull" } })
  )!;
  assert.equal(longP.style, "position");
  assert.equal(longP.bias, "long", "stacked-up EMAs on a position horizon override the fade into a trend");
  assert.match(longP.headline, /momentum long/);

  const shortP = buildVectorPlay(
    base({ horizon: "all", technicals: { emaStack: "down", macd: "bear" } })
  )!;
  assert.equal(shortP.bias, "short");
});

// ── Conviction / grade banding ───────────────────────────────────────────────
test("conviction: thin wall + transition regime + open space → C grade", () => {
  const play = buildVectorPlay(
    base({
      regime: { posture: "unknown" },
      gammaFlip: null,
      proximity: null,
      confluenceZones: [],
      technicals: { emaStack: "mixed" },
      magnet: null,
      expectedMove: null,
    })
  )!;
  assert.ok(play.conviction < 55, `expected C-grade, got ${play.conviction}`);
  assert.equal(play.grade, "C");
});

test("conviction: firm wall lifts the fade vs an identical thin-wall setup", () => {
  const firm = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), wallIntegrity: { call: firmIntegrity(7600, "call"), put: null } })
  )!;
  const thin = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), wallIntegrity: { call: thinIntegrity(7600, "call"), put: null } })
  )!;
  assert.ok(firm.conviction > thin.conviction, `firm ${firm.conviction} should beat thin ${thin.conviction}`);
});

test("conviction: confluence stacked at the play level raises conviction", () => {
  const withConf = buildVectorPlay(
    base({
      spot: 7598,
      proximity: proximity("call", 7600, "at"),
      confluenceZones: [
        { center: 7600, low: 7599, high: 7601, score: 9, kinds: ["call-wall", "max-pain", "pdh"], levels: [] } as ConfluenceZone,
      ],
    })
  )!;
  const without = buildVectorPlay(base({ spot: 7598, proximity: proximity("call", 7600, "at"), confluenceZones: [] }))!;
  assert.ok(withConf.conviction > without.conviction);
});

test("grade thresholds: A ≥75, B 55–74, C <55", () => {
  // Cheap direct check of the banding by driving conviction through inputs.
  const a = buildVectorPlay(
    base({
      spot: 7598,
      proximity: proximity("call", 7600, "at"),
      wallIntegrity: { call: firmIntegrity(7600, "call"), put: null },
      confluenceZones: [
        { center: 7600, low: 7599, high: 7601, score: 9, kinds: ["call-wall", "max-pain"], levels: [] } as ConfluenceZone,
      ],
      technicals: { emaStack: "down", macd: "bear", vwap: 7558 }, // agrees with the short fade
    })
  )!;
  assert.equal(a.grade, "A");
  const c = buildVectorPlay(base({ regime: { posture: "unknown" }, gammaFlip: null, proximity: null, magnet: null, expectedMove: null, technicals: {} }))!;
  assert.equal(c.grade, "C");
});

// ── Starred watch set ────────────────────────────────────────────────────────
test("starred: headline always first; wall-at and confluence added", () => {
  const play = buildVectorPlay(
    base({
      spot: 7598,
      proximity: proximity("call", 7600, "at"),
      confluenceZones: [
        { center: 7600, low: 7599, high: 7601, score: 8, kinds: ["call-wall", "max-pain"], levels: [] } as ConfluenceZone,
      ],
    })
  )!;
  assert.equal(play.starred[0], play.headline);
  assert.ok(play.starred.some((s) => /call wall at/.test(s)));
  assert.ok(play.starred.some((s) => /Confluence 7,600/.test(s)));
});

// ── BIE grounding (slice 3 shape, engine-side) ───────────────────────────────
test("BIE: a favorable historical bucket nudges conviction up and adds a starred evidence line", () => {
  const withBie = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), bie: { favPct: 0.68, samples: 214, windowDays: 60 } })
  )!;
  const noBie = buildVectorPlay(base({ spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.ok(withBie.conviction > noBie.conviction, "favorable BIE edge should raise conviction");
  assert.ok(withBie.starred.some((s) => /BIE · setups like this resolved 68% fav over 214 · 60d/.test(s)));
});

test("BIE: an unfavorable bucket lowers conviction (honest, not cosmetic)", () => {
  const bad = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), bie: { favPct: 0.3, samples: 200, windowDays: 60 } })
  )!;
  const noBie = buildVectorPlay(base({ spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.ok(bad.conviction < noBie.conviction);
});

test("BIE: zero samples never applied", () => {
  const zero = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), bie: { favPct: 0.9, samples: 0, windowDays: 60 } })
  )!;
  const noBie = buildVectorPlay(base({ spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.equal(zero.conviction, noBie.conviction);
  assert.ok(!zero.starred.some((s) => /BIE/.test(s)));
});

// ── Graceful degradation ─────────────────────────────────────────────────────
test("returns null when spot is missing/invalid — never fabricates a play", () => {
  assert.equal(buildVectorPlay(base({ spot: null })), null);
  assert.equal(buildVectorPlay(base({ spot: 0 })), null);
  assert.equal(buildVectorPlay(base({ spot: NaN })), null);
});

test("returns null when there is no structure of any kind", () => {
  const play = buildVectorPlay({
    ticker: "SPX",
    horizon: "0dte",
    timeframeMin: 5,
    spot: 7560,
    regime: { posture: "unknown" },
    gexWalls: { callWalls: [], putWalls: [] },
    gammaFlip: null,
    magnet: null,
    proximity: null,
    expectedMove: null,
    maxPain: null,
    confluenceZones: [],
    wallIntegrity: null,
    technicals: null,
  });
  assert.equal(play, null);
});

test("degrades to stand-aside (not null) when some structure exists but no clean edge", () => {
  const play = buildVectorPlay(
    base({ regime: { posture: "unknown" }, proximity: null, technicals: { emaStack: "mixed" }, magnet: null })
  )!;
  assert.ok(play, "still produces a play");
  assert.match(play.headline, /stand aside/);
  assert.equal(play.bias, "neutral");
});

test("missing expected-move / magnet / integrity: play still builds with real levels", () => {
  const play = buildVectorPlay(
    base({ spot: 7598, proximity: proximity("call", 7600, "at"), expectedMove: null, magnet: null, wallIntegrity: null })
  )!;
  assert.ok(play);
  assert.match(play.headline, /fade the 7,600 call wall/);
  assert.ok(play.targets.length > 0);
});

// ── Timeframe awareness ──────────────────────────────────────────────────────
test("invalidation reference tracks the chart timeframe", () => {
  const p5 = buildVectorPlay(base({ timeframeMin: 5, spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.match(p5.invalidation!, /5m close/);
  const p60 = buildVectorPlay(base({ timeframeMin: 60, spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.match(p60.invalidation!, /1H close/);
  const p15 = buildVectorPlay(base({ timeframeMin: 15, spot: 7598, proximity: proximity("call", 7600, "at") }))!;
  assert.match(p15.invalidation!, /15m close/);
});

// ── dataAge passthrough ──────────────────────────────────────────────────────
test("dataAge is passed through from input", () => {
  const play = buildVectorPlay(base({ dataAgeMs: 1234, proximity: proximity("call", 7600, "at") }))!;
  assert.equal(play.dataAge, 1234);
});
