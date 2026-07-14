// PR-N10 — debrief aggregate tests: rolling failure-mode counts (anti-blend), the
// counterfactual publish-gate validation (blocked value + published mirror), and the
// improvement queue's LOW-N discipline (thin evidence is visible but NEVER suggests).
// Hermetic and pure — fixture rows in, deterministic report out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPROVEMENT_BLOCKED_WINNER_RATE_PCT,
  analyzeNighthawkDebriefs,
  buildImprovementQueue,
  gateBlockedValue,
  gateCodesFromSnapshot,
  gatePublishedMirror,
  readPinnedDebriefTag,
  readPinnedTier,
  readRejectionCounterfactual,
  retroWouldBlock,
  summarizeDebriefPins,
  type DebriefAggregateRow,
  type NighthawkGateRejectionInput,
} from "./debrief-aggregate";
import { GRADE_METHODOLOGY_CURRENT, GRADE_METHODOLOGY_LEGACY } from "./grade-methodology";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

const WINDOW = { since: "2026-06-14", through: "2026-07-14", days: 30 };

function pin(tag: string): Record<string, unknown> {
  return { debrief_version: 1, failure_mode: { tag, detail: "fixture" } };
}

function row(over: Partial<DebriefAggregateRow> = {}): DebriefAggregateRow {
  return {
    edition_for: "2026-07-14",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    outcome: "stop",
    pulled: false,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    publish_context: null,
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    debrief: pin("stopped_normal"),
    ...over,
  };
}

function rejection(over: Partial<NighthawkGateRejectionInput> = {}): NighthawkGateRejectionInput {
  return {
    ticker: "DELL",
    edition_for: "2026-07-08",
    direction: "LONG",
    gate_codes: ["band_detached"],
    counterfactual: { version: 1, outcome: "unfilled", would_have_won: false },
    ...over,
  };
}

// ── Structural readers ───────────────────────────────────────────────────────────────

test("readPinnedDebriefTag: version-gated + taxonomy-gated (malformed/unknown → null)", () => {
  assert.equal(readPinnedDebriefTag(pin("clean_win")), "clean_win");
  assert.equal(readPinnedDebriefTag(null), null);
  assert.equal(readPinnedDebriefTag({ failure_mode: { tag: "clean_win" } }), null); // no version
  assert.equal(readPinnedDebriefTag(pin("not_a_real_tag")), null);
  assert.equal(readPinnedDebriefTag([pin("clean_win")]), null);
});

test("readPinnedTier: reads the slot structurally; absent today (no NH tier engine)", () => {
  assert.equal(readPinnedTier({ context_version: 2, tier: "a" }), "A");
  assert.equal(readPinnedTier({ context_version: 2 }), null);
  assert.equal(readPinnedTier(null), null);
});

test("readRejectionCounterfactual: ungradeable and malformed blobs read as not-graded", () => {
  assert.deepEqual(readRejectionCounterfactual({ outcome: "target", would_have_won: true }), {
    outcome: "target",
    would_have_won: true,
  });
  assert.equal(readRejectionCounterfactual({ outcome: "ungradeable" }), null);
  assert.equal(readRejectionCounterfactual(null), null);
  assert.equal(readRejectionCounterfactual("x"), null);
});

test("gateCodesFromSnapshot: parses + dedups the failed gate codes", () => {
  assert.deepEqual(
    gateCodesFromSnapshot({
      gate_blocks: [
        { code: "band_detached", reason: "..." },
        { code: "target_unreachable", reason: "..." },
        { code: "band_detached", reason: "dup" },
        { nope: true },
      ],
    }),
    ["band_detached", "target_unreachable"]
  );
  assert.deepEqual(gateCodesFromSnapshot(null), []);
  assert.deepEqual(gateCodesFromSnapshot({ gate_blocks: "x" }), []);
});

// ── Summary: anti-blend + LOW-N ──────────────────────────────────────────────────────

test("summarizeDebriefPins: counts current-methodology pins only; legacy rows CANNOT enter (anti-blend)", () => {
  const rows = [
    row({ edition_for: "2026-07-10", debrief: pin("clean_win") }),
    row({ edition_for: "2026-07-10", debrief: pin("gap_through_stop") }),
    row({ edition_for: "2026-07-11", debrief: pin("gap_through_stop") }),
    // A LEGACY row with a pinned clean_win — flipping it can never move the counts.
    row({ grade_methodology: GRADE_METHODOLOGY_LEGACY, debrief: pin("clean_win") }),
    // Unstamped provenance quarantines to legacy too.
    row({ grade_methodology: null, debrief: pin("clean_win") }),
    // Current but not yet debriefed.
    row({ debrief: null }),
    // Pending rows never count.
    row({ outcome: "pending", debrief: null }),
  ];
  const s = summarizeDebriefPins(rows);
  assert.equal(s.graded, 4); // 3 pinned + 1 unpinned current
  assert.equal(s.debriefed, 3);
  assert.equal(s.sessions, 2);
  assert.equal(s.legacy_excluded, 2);
  assert.equal(s.unpinned, 1);
  assert.deepEqual(s.failure_modes, [
    { tag: "gap_through_stop", n: 2 },
    { tag: "clean_win", n: 1 },
  ]);
  assert.equal(s.low_n, true); // 3 < LOW_N_THRESHOLD
});

test("summarizeDebriefPins: low_n clears at the shared threshold", () => {
  const rows = Array.from({ length: LOW_N_THRESHOLD }, (_, i) =>
    row({ edition_for: `2026-07-0${(i % 5) + 1}`, debrief: pin("stopped_normal") })
  );
  assert.equal(summarizeDebriefPins(rows).low_n, false);
});

// ── Blocked value ────────────────────────────────────────────────────────────────────

test("gateBlockedValue: per-gate n / graded / would-have-won rate; unfilled counterfactuals are separated", () => {
  const lines = gateBlockedValue([
    rejection(), // unfilled counterfactual — trivially right, not in the won/lost read
    rejection({ ticker: "A", counterfactual: { version: 1, outcome: "target", would_have_won: true } }),
    rejection({ ticker: "B", counterfactual: { version: 1, outcome: "stop", would_have_won: false } }),
    rejection({ ticker: "C", counterfactual: null }), // not graded yet
    rejection({
      ticker: "D",
      gate_codes: ["band_detached", "target_unreachable"], // counts under BOTH gates
      counterfactual: { version: 1, outcome: "stop", would_have_won: false },
    }),
  ]);
  const band = lines.find((l) => l.gate === "band_detached")!;
  assert.equal(band.blocked_n, 5);
  assert.equal(band.graded_n, 4);
  assert.equal(band.ungraded_n, 1);
  assert.equal(band.unfilled_n, 1);
  assert.equal(band.would_have_won, 1);
  assert.equal(band.would_have_won_rate_pct, 33.3); // 1 of 3 decisive
  assert.equal(band.low_n, true);
  const target = lines.find((l) => l.gate === "target_unreachable")!;
  assert.equal(target.blocked_n, 1);
  assert.equal(target.would_have_won_rate_pct, 0);
});

// ── Published mirror (retro gates from the pinned margins) ───────────────────────────

test("retroWouldBlock: uses the LIVE thresholds against the PINNED geometry; no pin → null", () => {
  const detached = row({ publish_context: { context_version: 2, band_distance_pct: -45.5 } });
  const healthy = row({ publish_context: { context_version: 2, band_distance_pct: -1.2, atr14: 4 } });
  assert.equal(retroWouldBlock(detached, "band_detached"), true);
  assert.equal(retroWouldBlock(healthy, "band_detached"), false);
  assert.equal(retroWouldBlock(row({ publish_context: null }), "band_detached"), null);
  // Target gate: |110-102|/4 = 2× > 1.5× → block; |110-102|/8 = 1× → pass.
  assert.equal(retroWouldBlock(healthy, "target_unreachable"), true);
  assert.equal(
    retroWouldBlock(row({ publish_context: { context_version: 2, atr14: 8 } }), "target_unreachable"),
    false
  );
  assert.equal(retroWouldBlock(row({ publish_context: { context_version: 2 } }), "target_unreachable"), null);
});

test("gatePublishedMirror: buckets scoreable current rows by retro verdict; unfilled/pulled excluded", () => {
  const geoBlock = { context_version: 2, band_distance_pct: -10, atr14: 100 };
  const geoPass = { context_version: 2, band_distance_pct: -1, atr14: 100 };
  const rows = [
    row({ outcome: "stop", publish_context: geoBlock }),
    row({ outcome: "stop", publish_context: geoBlock }),
    row({ outcome: "target", publish_context: geoPass }),
    row({ outcome: "stop", publish_context: geoPass }),
    row({ outcome: "unfilled", publish_context: geoBlock }), // excluded — not scoreable
    row({ outcome: "target", pulled: true, publish_context: geoPass }), // excluded — pulled
    row({ outcome: "open", publish_context: null }), // no geometry
  ];
  const band = gatePublishedMirror(rows).find((l) => l.gate === "band_detached")!;
  assert.equal(band.would_block.n, 2);
  assert.equal(band.would_block.win_rate_pct, 0);
  assert.equal(band.would_pass.n, 2);
  assert.equal(band.would_pass.win_rate_pct, 50);
  assert.equal(band.delta_win_rate_pts, 50);
  assert.equal(band.no_geometry_n, 1);
  assert.equal(band.would_block.low_n, true);
});

// ── Improvement queue: shape + LOW-N never suggests ──────────────────────────────────

test("improvement queue: every item carries {signal, evidence:{n, delta}, suggestion, low_n}; LOW-N items NEVER suggest", () => {
  const rows = [
    row({ debrief: pin("gap_through_stop") }),
    row({ debrief: pin("gap_through_stop") }),
    row({ debrief: pin("clean_win"), outcome: "target" }),
  ];
  const report = analyzeNighthawkDebriefs({
    rows,
    rejections: [rejection(), rejection({ ticker: "A", counterfactual: { version: 1, outcome: "target", would_have_won: true } })],
    window: WINDOW,
  });
  assert.ok(report.improvement_queue.length > 0);
  for (const item of report.improvement_queue) {
    assert.equal(typeof item.signal, "string");
    assert.equal(typeof item.evidence.n, "number");
    assert.ok("delta" in item.evidence);
    assert.ok("suggestion" in item);
    assert.equal(typeof item.low_n, "boolean");
    // THE LOW-N CONTRACT: thin evidence is visible but never actionable.
    if (item.low_n) assert.equal(item.suggestion, null);
  }
  // Everything in this fixture is low-n, so nothing may suggest.
  assert.ok(report.improvement_queue.every((i) => i.low_n && i.suggestion === null));
});

test("improvement queue: at real n, a gate blocking winners earns a re-examine suggestion; one blocking losers earns keep-enforcing", () => {
  const winners = Array.from({ length: 5 }, (_, i) =>
    rejection({ ticker: `W${i}`, counterfactual: { version: 1, outcome: "target", would_have_won: true } })
  );
  const losers = Array.from({ length: 5 }, (_, i) =>
    rejection({
      ticker: `L${i}`,
      gate_codes: ["target_unreachable"],
      counterfactual: { version: 1, outcome: "stop", would_have_won: false },
    })
  );
  const queue = buildImprovementQueue({
    summary: summarizeDebriefPins([]),
    blockedValue: gateBlockedValue([...winners, ...losers]),
    mirror: [],
    byConviction: [],
  });
  const bad = queue.find((i) => i.signal === "publish_gate:band_detached:blocked_value")!;
  assert.equal(bad.low_n, false);
  assert.ok(bad.evidence.delta! >= IMPROVEMENT_BLOCKED_WINNER_RATE_PCT);
  assert.match(bad.suggestion!, /re-examine/);
  const good = queue.find((i) => i.signal === "publish_gate:target_unreachable:blocked_value")!;
  assert.match(good.suggestion!, /earning its keep/);
  // Actionable items sort ahead of low-n ones.
  assert.equal(queue[0]!.low_n, false);
});

test("improvement queue: dominant failure mode signals with its share; conviction inversion flagged at usable n", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => row({ ticker: `G${i}`, debrief: pin("gap_through_stop") })),
    row({ debrief: pin("clean_win"), outcome: "target" }),
    row({ debrief: pin("stopped_normal") }),
  ];
  const summary = summarizeDebriefPins(rows);
  const queue = buildImprovementQueue({
    summary,
    blockedValue: [],
    mirror: [],
    byConviction: [
      { key: "A", n: 6, scoreable: 6, wins: 1, losses: 5, unfilled: 0, pulled: 0, win_rate_pct: 16.7, dominant_failure_mode: null, low_n: false },
      { key: "B", n: 6, scoreable: 6, wins: 4, losses: 2, unfilled: 0, pulled: 0, win_rate_pct: 66.7, dominant_failure_mode: null, low_n: false },
    ],
  });
  const dom = queue.find((i) => i.signal === "failure_mode:gap_through_stop:dominant")!;
  assert.equal(dom.evidence.n, 4);
  assert.equal(dom.evidence.delta, 66.7); // 4 of 6 debriefed
  assert.match(dom.suggestion!, /overnight gaps/);
  const inv = queue.find((i) => i.signal === "conviction:A_below_B:inversion")!;
  assert.equal(inv.low_n, false);
  assert.equal(inv.evidence.delta, 50);
  assert.match(inv.suggestion!, /mis-weighted/);
});

// ── Full report shape ────────────────────────────────────────────────────────────────

test("analyzeNighthawkDebriefs: report shape, per-conviction records, empty-tier honesty, availability", () => {
  const rows = [
    row({ conviction: "A", outcome: "target", debrief: pin("clean_win") }),
    row({ conviction: "A", outcome: "stop", debrief: pin("gap_through_stop") }),
    row({ conviction: "B", outcome: "unfilled", debrief: pin("band_detached") }),
    row({ conviction: "B", outcome: "target", pulled: true, debrief: pin("pulled_wrongly") }),
  ];
  const report = analyzeNighthawkDebriefs({ rows, rejections: [], window: WINDOW });
  assert.equal(report.available, true);
  assert.equal(report.window, WINDOW);
  assert.match(report.methodology, /anti-blend|legacy/i);
  const a = report.by_conviction.find((c) => c.key === "A")!;
  assert.equal(a.n, 2);
  assert.equal(a.scoreable, 2);
  assert.equal(a.win_rate_pct, 50);
  assert.equal(a.low_n, true);
  const b = report.by_conviction.find((c) => c.key === "B")!;
  assert.equal(b.scoreable, 0); // unfilled + pulled never enter the denominator
  assert.equal(b.win_rate_pct, null); // null, never a fake 0%
  assert.equal(b.unfilled, 1);
  assert.equal(b.pulled, 1);
  assert.deepEqual(report.by_tier, []); // no tier pinned anywhere yet — empty, not invented
  assert.equal(report.gate_validation.published_mirror.length, 2);
});

test("analyzeNighthawkDebriefs: empty input → available:false, stable shape", () => {
  const report = analyzeNighthawkDebriefs({ rows: [], rejections: [], window: WINDOW });
  assert.equal(report.available, false);
  assert.equal(report.summary.debriefed, 0);
  assert.deepEqual(report.improvement_queue, []);
  assert.equal(report.by_conviction.length, 4);
});
