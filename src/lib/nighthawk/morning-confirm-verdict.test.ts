import assert from "node:assert/strict";
import test from "node:test";
import { computePlayVerdict } from "./morning-confirm-verdict";
import type { PlaybookPlay } from "./types";

// Batch D regression suite (2026-07-02 audit): the confirm engine previously
// (a) returned CONFIRMED "All checks passed" on zero data, and (b) only checked the
// SPX index gap — a play whose own stock gapped through its stop still confirmed.

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "TEST",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$100-$104",
    target: "$112",
    stop: "$96",
    options_play: "TEST 110C",
    ...overrides,
  };
}

const NO_CONTEXT = {
  gapPts: null,
  regime: null,
  anomalies: [],
  callWall: null,
  putWall: null,
  editionCallWall: null,
  editionPutWall: null,
  stockPremarket: null,
};

test("zero evaluable data returns UNVERIFIED, never a green CONFIRMED", () => {
  const v = computePlayVerdict(play(), NO_CONTEXT);
  assert.equal(v.status, "UNVERIFIED");
  assert.ok(v.reason.includes("withheld"));
});

test("stock gapped through its STOP pre-open → INVALIDATED (long)", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, stockPremarket: 94.5 });
  assert.equal(v.status, "INVALIDATED");
  assert.ok(v.reason.includes("gapped through the stop"));
});

test("stock gapped through its STOP pre-open → INVALIDATED (short mirror)", () => {
  const v = computePlayVerdict(
    play({ direction: "SHORT", entry_range: "$200-$204", target: "$188", stop: "$212" }),
    { ...NO_CONTEXT, stockPremarket: 215 }
  );
  assert.equal(v.status, "INVALIDATED");
});

test("stock already at/through TARGET pre-open → DEGRADED (reward consumed)", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, stockPremarket: 113 });
  assert.equal(v.status, "DEGRADED");
  assert.ok(v.reason.includes("target"));
});

test("stock gapped above the entry range → DEGRADED, do-not-chase", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, stockPremarket: 106 });
  assert.equal(v.status, "DEGRADED");
  assert.ok(v.reason.includes("entry range"));
});

test("stock inside its entry range with no other signals → CONFIRMED", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, stockPremarket: 102 });
  assert.equal(v.status, "CONFIRMED");
  assert.equal(v.reason, "All checks passed");
});

test("SPX gap against direction still INVALIDATES (existing behavior preserved)", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, gapPts: -25, stockPremarket: 102 });
  assert.equal(v.status, "INVALIDATED");
  assert.ok(v.reason.includes("SPX gapped"));
});

test("bullish regime with no other data still evaluates (not UNVERIFIED)", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, regime: "bullish trend" });
  assert.equal(v.status, "CONFIRMED");
});

test("regime flip against a LONG invalidates", () => {
  const v = computePlayVerdict(play(), { ...NO_CONTEXT, regime: "bearish breakdown" });
  assert.equal(v.status, "INVALIDATED");
});
