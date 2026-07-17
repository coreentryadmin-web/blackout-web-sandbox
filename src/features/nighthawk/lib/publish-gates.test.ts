import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptableQuoteSessionsEt,
  applyNighthawkPublishGates,
  evaluateNighthawkPublishGates,
  GATE_BAND_MAX_DISTANCE_PCT,
  GATE_TARGET_MAX_ATR_MULTIPLE,
  promoteTopBlocked,
  publishGateRecapReason,
} from "./publish-gates";
import {
  buildNighthawkStageRejectedAuditRow,
  REJECTION_TRIGGER_REASON,
} from "./play-outcomes";
import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";
import type { TickerDossier } from "./dossier";

// PR-N3 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §N-3): publish-time sanity gates.
// Contract under test:
//  (a) each gate blocks/passes exactly at its documented boundary, both directions;
//  (b) the measured failure classes are caught: the six 6.4%–45.5% backfill plays
//      (DELL fixture) and the 14/24 >3% detached-band class;
//  (c) FAIL-CLOSED — uncomputable geometry never publishes (geometry_unknown);
//  (d) blocked plays persist as nighthawk_rejected audit rows with the gate blocks;
//  (e) PASS results still carry per-gate margins (the calibration substrate).

const SESSION = "2026-07-13";

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$106.50-$107.50",
    target: "$110.00",
    stop: "$104.00",
    options_play: "AMD 110C",
    score: 72,
    entry_premium: 3.5,
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "AMD",
    score: 72,
    direction: "long",
    flow_score: 30,
    tech_score: 12,
    pos_score: 10,
    news_score: 4,
    smart_money_score: 3,
    conviction: "A",
    ...overrides,
  } as ScoredCandidate;
}

/** Only tech (price/prior_day/atr14/price_session) and scored are read by the gates —
 *  a partial cast keeps the fixture honest about that. */
function dossier(
  overrides: {
    ticker?: string;
    price?: number | null;
    priorClose?: number | null;
    atr14?: number | null;
    priceSession?: string | null;
    scored?: ScoredCandidate;
    tech?: null;
  } = {}
): TickerDossier {
  if (overrides.tech === null) {
    return { ticker: overrides.ticker ?? "AMD", scored: overrides.scored, tech: null } as unknown as TickerDossier;
  }
  return {
    ticker: overrides.ticker ?? "AMD",
    sector: "Technology",
    scored: overrides.scored,
    tech: {
      ticker: overrides.ticker ?? "AMD",
      price: overrides.price ?? 108,
      price_session: overrides.priceSession === undefined ? SESSION : overrides.priceSession,
      trend: "up",
      setup_tags: [],
      support_levels: [],
      resistance_levels: [],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: 109, low: 105, close: overrides.priorClose ?? 107.5 },
      weekly: { high: null, low: null },
      rsi14: null,
      rel_volume: null,
      atr14: overrides.atr14 === undefined ? 4.2 : overrides.atr14,
      vwap: null,
      ema20: null,
      ema50: null,
      ema200: null,
      summary: "",
    },
  } as unknown as TickerDossier;
}

function evaluate(p: PlaybookPlay, d: TickerDossier | null, sessions: string[] = [SESSION]) {
  return evaluateNighthawkPublishGates({ play: p, dossier: d, quoteSessions: sessions });
}

// ── Healthy play: PUBLISH, with margins pinned ─────────────────────────────────────────

test("healthy play PUBLISHes and the result carries every gate's PASS margin", () => {
  const res = evaluate(play(), dossier());
  assert.equal(res.verdict, "PUBLISH");
  assert.deepEqual(res.blocks, []);
  // All four checks evaluated, all passed, with raw value vs threshold (calibration data).
  assert.deepEqual(
    res.checks.map((c) => [c.code, c.passed]),
    [
      ["geometry_unknown", true],
      ["band_detached", true],
      ["target_unreachable", true],
      ["stale_quote_basis", true],
    ]
  );
  const band = res.checks.find((c) => c.code === "band_detached")!;
  // LONG fill edge 107.5 vs spot 108 → −0.463% pullback entry, well inside 3.5%.
  assert.equal(band.value, -0.463);
  assert.equal(band.threshold, GATE_BAND_MAX_DISTANCE_PCT);
  const target = res.checks.find((c) => c.code === "target_unreachable")!;
  // |110 − 107.5| / 4.2 = 0.5952× ATR14.
  assert.equal(target.value, 0.5952);
  assert.equal(target.threshold, GATE_TARGET_MAX_ATR_MULTIPLE);
});

// ── G-N1 band-vs-spot boundary, both directions ────────────────────────────────────────

test("G-N1 boundary: LONG band edge exactly 3.5% below spot passes; a hair beyond blocks", () => {
  // spot 100, fill edge (band top) 96.50 → −3.5% exactly → allowed (≤, not <).
  const at = evaluate(
    play({ entry_range: "$96.00-$96.50", target: "$99.00", stop: "$94.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(at.verdict, "PUBLISH");

  // fill edge 96.40 → −3.6% → band_detached.
  const beyond = evaluate(
    play({ entry_range: "$96.00-$96.40", target: "$99.00", stop: "$94.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(beyond.verdict, "BLOCK");
  assert.deepEqual(beyond.blocks.map((b) => b.code), ["band_detached"]);
  assert.equal(beyond.blocks[0]!.value, -3.6);
  assert.equal(beyond.blocks[0]!.threshold, GATE_BAND_MAX_DISTANCE_PCT);
});

test("G-N1 is an ABSOLUTE distance: a LONG band 3.6% ABOVE spot is just as unfillable", () => {
  const res = evaluate(
    play({ entry_range: "$103.40-$103.60", target: "$106.00", stop: "$101.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(res.verdict, "BLOCK");
  assert.deepEqual(res.blocks.map((b) => b.code), ["band_detached"]);
  assert.equal(res.blocks[0]!.value, 3.6);
});

test("G-N1 SHORT mirror: fill edge is the band LOW; 3.5% above spot passes, 3.6% blocks", () => {
  const at = evaluate(
    play({ direction: "SHORT", entry_range: "$103.50-$104.00", target: "$100.00", stop: "$106.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(at.verdict, "PUBLISH");

  const beyond = evaluate(
    play({ direction: "SHORT", entry_range: "$103.60-$104.00", target: "$100.00", stop: "$106.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(beyond.verdict, "BLOCK");
  assert.deepEqual(beyond.blocks.map((b) => b.code), ["band_detached"]);
  assert.equal(beyond.blocks[0]!.value, 3.6);
});

// ── G-N2 achievable target boundary, both directions ───────────────────────────────────

test("G-N2 boundary: target exactly K×ATR14 from the fill edge passes; beyond blocks", () => {
  // fill edge 100, ATR14 4 → allowance 2.5 × 4 = 10.00. Target 110.00 → exactly 2.5×.
  const at = evaluate(
    play({ entry_range: "$99.50-$100.00", target: "$110.00", stop: "$97.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(at.verdict, "PUBLISH");

  // Target 110.10 → 2.525× → target_unreachable.
  const beyond = evaluate(
    play({ entry_range: "$99.50-$100.00", target: "$110.10", stop: "$97.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(beyond.verdict, "BLOCK");
  assert.deepEqual(beyond.blocks.map((b) => b.code), ["target_unreachable"]);
  assert.equal(beyond.blocks[0]!.value, 2.525);
  assert.equal(beyond.blocks[0]!.threshold, GATE_TARGET_MAX_ATR_MULTIPLE);
});

test("G-N2 SHORT mirror: distance is absolute, so a downside target measures the same", () => {
  // fill edge 100.00, ATR14 4 → allowance 2.5 × 4 = 10.00. Target 90.00 → exactly 2.5×.
  const at = evaluate(
    play({ direction: "SHORT", entry_range: "$100.00-$100.50", target: "$90.00", stop: "$103.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(at.verdict, "PUBLISH");

  // Target 89.90 → 2.525× → target_unreachable.
  const beyond = evaluate(
    play({ direction: "SHORT", entry_range: "$100.00-$100.50", target: "$89.90", stop: "$103.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(beyond.verdict, "BLOCK");
  assert.deepEqual(beyond.blocks.map((b) => b.code), ["target_unreachable"]);
});

// ── G-N3 stale-quote guard ──────────────────────────────────────────────────────────────

test("G-N3: quote from a prior session blocks; quote from the publish session passes", () => {
  const stale = evaluate(play(), dossier({ priceSession: "2026-07-10" }), [SESSION]);
  assert.equal(stale.verdict, "BLOCK");
  assert.deepEqual(stale.blocks.map((b) => b.code), ["stale_quote_basis"]);
  assert.equal(stale.blocks[0]!.value, "2026-07-10");
  assert.equal(stale.blocks[0]!.threshold, SESSION);

  const fresh = evaluate(play(), dossier({ priceSession: SESSION }), [SESSION]);
  assert.equal(fresh.verdict, "PUBLISH");
});

test("G-N3 lenient: an UNDATEABLE quote (price_session null) passes — hourly fallback is valid off-hours", () => {
  const res = evaluate(play(), dossier({ priceSession: null }), [SESSION]);
  assert.equal(res.verdict, "PUBLISH");
  assert.equal(res.checks.find((c) => c.code === "stale_quote_basis")?.passed, true);
});

test("G-N3 accepts ANY listed session (intraday build: today's partial bar or prior close)", () => {
  const res = evaluate(play(), dossier({ priceSession: "2026-07-10" }), [SESSION, "2026-07-10"]);
  assert.equal(res.verdict, "PUBLISH");
});

// ── Fail-closed geometry_unknown ────────────────────────────────────────────────────────

test("fail-closed: no dossier/tech card ⇒ geometry_unknown BLOCK — a pick we can't sanity-check is not a pick", () => {
  for (const d of [null, dossier({ tech: null })]) {
    const res = evaluate(play(), d);
    assert.equal(res.verdict, "BLOCK");
    assert.deepEqual(res.blocks.map((b) => b.code), ["geometry_unknown"]);
    assert.match(String(res.blocks[0]!.value), /spot/);
  }
});

test("fail-closed: missing ATR14 (no fallback) or unparseable band each yield geometry_unknown, naming the gap", () => {
  // PR-N21: when atr14 is null but prior_day is present, estimateAtr fills in from H/L
  // range — that's the intended fallback. The play publishes.
  const atrEstimated = evaluate(play(), dossier({ atr14: null }));
  assert.equal(atrEstimated.verdict, "PUBLISH");

  // When BOTH atr14 AND prior_day AND spot are missing, ATR truly can't be estimated.
  const noAtrNoFallback = evaluate(play(), { ticker: "AMD", scored: null, tech: {
    ticker: "AMD", price: null, price_session: SESSION, trend: "up",
    setup_tags: [], support_levels: [], resistance_levels: [], gap_zones: [],
    breakout_zones: [], prior_day: null, weekly: { high: null, low: null },
    rsi14: null, rel_volume: null, atr14: null, vwap: null,
    ema20: null, ema50: null, ema200: null,
  } } as unknown as TickerDossier);
  assert.equal(noAtrNoFallback.verdict, "BLOCK");
  assert.equal(noAtrNoFallback.blocks[0]!.code, "geometry_unknown");

  const noBand = evaluate(play({ entry_range: "See technical levels" }), dossier());
  assert.equal(noBand.verdict, "BLOCK");
  assert.equal(noBand.blocks[0]!.code, "geometry_unknown");
  assert.match(String(noBand.blocks[0]!.value), /fill_edge/);
});

// ── The measured failure classes (doc §N-3) ────────────────────────────────────────────

test("DELL 2026-07-08 fixture (band $226.82–227.27, stock $417, target $469.47): band_detached AND target_unreachable", () => {
  // Fresh quote on purpose — the detachment alone must catch the backfill class even
  // when the quote basis looks current (deep-support anchoring, not only staleness).
  const res = evaluate(
    play({ ticker: "DELL", entry_range: "$226.82-$227.27", target: "$469.47", stop: "$224.55" }),
    dossier({ ticker: "DELL", price: 417, priorClose: 415.2, atr14: 12.5 })
  );
  assert.equal(res.verdict, "BLOCK");
  assert.deepEqual(res.blocks.map((b) => b.code), ["band_detached", "target_unreachable"]);
  // (227.27 − 417) / 417 = −45.4988% — the doc's −45.5% worst case, reproduced exactly.
  assert.equal(res.blocks[0]!.value, -45.4988);
  // (469.47 − 227.27) / 12.5 = 19.376× ATR14 — an order of magnitude past K=2.5.
  assert.equal(res.blocks[1]!.value, 19.376);
});

test("the >3.5% detached-band class blocks; a normal ~1.5% pullback entry publishes", () => {
  // Band top 3.6% below spot — outside the 3.5% gate.
  const detached = evaluate(
    play({ entry_range: "$96.00-$96.40", target: "$99.00", stop: "$94.00" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(detached.verdict, "BLOCK");
  assert.deepEqual(detached.blocks.map((b) => b.code), ["band_detached"]);

  // Healthy plays were within ~1.5% of spot (doc §N-3) — must keep publishing.
  const healthy = evaluate(
    play({ entry_range: "$98.00-$98.50", target: "$101.00", stop: "$96.50" }),
    dossier({ price: 100, atr14: 4 })
  );
  assert.equal(healthy.verdict, "PUBLISH");
});

// ── Edition-level application ──────────────────────────────────────────────────────────

test("applyNighthawkPublishGates: blocked plays drop out, survivors re-rank, results map covers BOTH", () => {
  const good = play({ ticker: "NVDA", rank: 1 });
  const dell = play({
    ticker: "DELL",
    rank: 2,
    entry_range: "$226.82-$227.27",
    target: "$469.47",
    stop: "$224.55",
  });
  const dellScored = scored({ ticker: "DELL" });
  const out = applyNighthawkPublishGates({
    plays: [dell, good],
    dossiers: {
      NVDA: dossier({ ticker: "NVDA" }),
      DELL: dossier({ ticker: "DELL", price: 417, atr14: 12.5, scored: dellScored }),
    },
    quoteSessions: [SESSION],
  });

  assert.deepEqual(out.passing.map((p) => [p.ticker, p.rank]), [["NVDA", 1]]);
  assert.equal(out.blocked.length, 1);
  assert.equal(out.blocked[0]!.ticker, "DELL");
  // The scorer's confluence read rides along for the rejection audit row.
  assert.equal(out.blocked[0]!.scored, dellScored);
  assert.equal(out.results.NVDA!.verdict, "PUBLISH");
  assert.equal(out.results.DELL!.verdict, "BLOCK");
});

test("applyNighthawkPublishGates is fail-closed on an evaluator throw — never silently published", () => {
  const bomb = play({ ticker: "BOOM" });
  Object.defineProperty(bomb, "entry_range", {
    get() {
      throw new Error("synthetic accessor failure");
    },
  });
  const out = applyNighthawkPublishGates({
    plays: [bomb],
    dossiers: { BOOM: dossier({ ticker: "BOOM" }) },
    quoteSessions: [SESSION],
  });
  assert.deepEqual(out.passing, []);
  assert.equal(out.blocked[0]!.result.blocks[0]!.code, "geometry_unknown");
  assert.match(out.blocked[0]!.result.blocks[0]!.reason, /fail-closed/);
});

test("all-blocked edition: zero survivors + an honest recap reason (zero honest plays beats an unfillable pick)", () => {
  const dell = play({ ticker: "DELL", entry_range: "$226.82-$227.27", target: "$469.47", stop: "$224.55" });
  const out = applyNighthawkPublishGates({
    plays: [dell],
    dossiers: { DELL: dossier({ ticker: "DELL", price: 417, atr14: 12.5 }) },
    quoteSessions: [SESSION],
  });
  assert.deepEqual(out.passing, []);
  const reason = publishGateRecapReason(out.blocked);
  assert.match(reason, /blocked all 1 play/);
  assert.match(reason, /DELL: band_detached,target_unreachable/);
  assert.match(reason, /zero honest plays/);
});

// ── Rejected-candidate persistence (nighthawk_rejected audit row) ──────────────────────

test("blocked play persists as a nighthawk_rejected audit row carrying the gate blocks verbatim", () => {
  const dell = play({ ticker: "DELL", entry_range: "$226.82-$227.27", target: "$469.47", stop: "$224.55" });
  const d = dossier({ ticker: "DELL", price: 417, atr14: 12.5 });
  const result = evaluate(dell, d);
  assert.equal(result.verdict, "BLOCK");

  const row = buildNighthawkStageRejectedAuditRow(
    { ticker: "DELL", play: dell, detail: { stage: "publish_gate", blocks: result.blocks }, scored: scored({ ticker: "DELL" }) },
    "2026-07-14"
  );
  // Same shape/write-path as every other rejection stage: this row is the play's ONLY record.
  assert.equal(row.alert_type, "nighthawk_rejected");
  assert.equal(row.source_table, "claude_edition_synthesis");
  assert.deepEqual(row.source_key, { edition_for: "2026-07-14", ticker: "DELL" });
  assert.equal(row.trigger_reason, REJECTION_TRIGGER_REASON.publish_gate);
  // One decision-trace entry per failed gate, value/threshold verbatim.
  assert.deepEqual(
    row.decision_trace.map((t) => [t.check, t.passed, t.value, t.threshold]),
    [
      ["band_detached", false, -45.4988, GATE_BAND_MAX_DISTANCE_PCT],
      ["target_unreachable", false, 19.376, GATE_TARGET_MAX_ATR_MULTIPLE],
    ]
  );
  assert.deepEqual(row.input_snapshot.gate_blocks, result.blocks);
  assert.equal(row.final_output, null, "a gated play was never shown to a member");
});

// ── Quote-basis session math (G-N3's expected sessions) ────────────────────────────────

test("acceptableQuoteSessionsEt: after the close only TODAY's session is an honest basis", () => {
  // Tue 2026-07-14 22:00 ET (the overnight build window).
  assert.deepEqual(acceptableQuoteSessionsEt(new Date("2026-07-15T02:00:00Z")), ["2026-07-14"]);
});

test("acceptableQuoteSessionsEt: during RTH, today's in-progress bar OR the prior close are both acceptable", () => {
  // Tue 2026-07-14 10:00 ET.
  assert.deepEqual(acceptableQuoteSessionsEt(new Date("2026-07-14T14:00:00Z")), [
    "2026-07-14",
    "2026-07-13",
  ]);
});

test("acceptableQuoteSessionsEt walks weekends and holidays to the last COMPLETED session", () => {
  // Sunday 2026-07-12 11:00 ET → Friday 2026-07-10.
  assert.deepEqual(acceptableQuoteSessionsEt(new Date("2026-07-12T15:00:00Z")), ["2026-07-10"]);
  // Monday 2026-07-06 08:00 ET, pre-open after the 7/03 holiday weekend →
  // today's (not yet traded) session plus Thursday 7/02, the last completed one.
  assert.deepEqual(acceptableQuoteSessionsEt(new Date("2026-07-06T12:00:00Z")), [
    "2026-07-06",
    "2026-07-02",
  ]);
});

// ── PR-N13 promoteTopBlocked ─────────────────────────────────────────────────

test("promoteTopBlocked returns empty array on empty input", () => {
  assert.deepEqual(promoteTopBlocked([], 5), []);
});

test("promoteTopBlocked returns empty array on count <= 0", () => {
  const blocked = [{
    ticker: "AMD",
    play: play(),
    result: {
      verdict: "BLOCK" as const,
      blocks: [{ code: "band_detached" as const, reason: "too far", threshold: 3.5, value: 5.2 }],
      checks: [],
    },
    scored: null,
  }];
  assert.deepEqual(promoteTopBlocked(blocked, 0), []);
});

test("promoteTopBlocked ranks by fewer gate failures first, then by score", () => {
  const blocked = [
    {
      ticker: "AAPL",
      play: play({ ticker: "AAPL", score: 80 }),
      result: {
        verdict: "BLOCK" as const,
        blocks: [
          { code: "band_detached" as const, reason: "r1", threshold: 3.5, value: 4.1 },
          { code: "target_unreachable" as const, reason: "r2", threshold: 2.0, value: 3.5 },
        ],
        checks: [],
      },
      scored: null,
    },
    {
      ticker: "NVDA",
      play: play({ ticker: "NVDA", score: 60 }),
      result: {
        verdict: "BLOCK" as const,
        blocks: [{ code: "band_detached" as const, reason: "r3", threshold: 3.5, value: 3.8 }],
        checks: [],
      },
      scored: null,
    },
    {
      ticker: "TSLA",
      play: play({ ticker: "TSLA", score: 90 }),
      result: {
        verdict: "BLOCK" as const,
        blocks: [{ code: "target_unreachable" as const, reason: "r4", threshold: 2.0, value: 2.5 }],
        checks: [],
      },
      scored: null,
    },
  ];

  const promoted = promoteTopBlocked(blocked, 2);
  assert.equal(promoted.length, 2);
  // TSLA (1 failure, score 90) should rank first, NVDA (1 failure, score 60) second.
  // AAPL (2 failures) is dropped.
  assert.equal(promoted[0].ticker, "TSLA");
  assert.equal(promoted[0].rank, 1);
  assert.equal(promoted[0].gate_promoted, true);
  assert.deepEqual(promoted[0].gate_warnings, ["r4"]);

  assert.equal(promoted[1].ticker, "NVDA");
  assert.equal(promoted[1].rank, 2);
  assert.equal(promoted[1].gate_promoted, true);
});

test("promoteTopBlocked caps at count", () => {
  const blocked = Array.from({ length: 10 }, (_, i) => ({
    ticker: `T${i}`,
    play: play({ ticker: `T${i}`, score: 50 + i }),
    result: {
      verdict: "BLOCK" as const,
      blocks: [{ code: "band_detached" as const, reason: `r${i}`, threshold: 3.5, value: 4.0 }],
      checks: [],
    },
    scored: null,
  }));
  const promoted = promoteTopBlocked(blocked, 3);
  assert.equal(promoted.length, 3);
});
