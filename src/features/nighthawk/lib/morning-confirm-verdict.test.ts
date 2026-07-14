import assert from "node:assert/strict";
import test from "node:test";
import {
  computePlayVerdict,
  formatCheckedAtEt,
  isMorningConfirmStale,
  worsenPlayStatus,
  MORNING_CONFIRM_STALE_MS,
} from "./morning-confirm-verdict";
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

// Regression (audit P3): a TSLA DEGRADED badge computed at 9:16 ET was still shown
// unchanged at 14:49 ET (5.5h later) with no indication it was a frozen pre-market
// snapshot rather than a live status. isMorningConfirmStale() is the signal the UI
// uses to mute the badge and add an "as of" qualifier once it's old enough to mislead.
test("isMorningConfirmStale: false immediately after the check", () => {
  const checkedAt = "2026-07-07T13:16:00.000Z"; // 9:16 ET
  const now = Date.parse("2026-07-07T13:20:00.000Z"); // 4 min later
  assert.equal(isMorningConfirmStale(checkedAt, now), false);
});

test("isMorningConfirmStale: true once the 4h threshold is exceeded (the live repro)", () => {
  const checkedAt = "2026-07-07T13:16:00.000Z"; // 9:16 ET
  const now = Date.parse("2026-07-07T18:49:00.000Z"); // 14:49 ET, 5.5h later
  assert.equal(isMorningConfirmStale(checkedAt, now), true);
});

test("isMorningConfirmStale: exactly at the threshold is not yet stale (> not >=)", () => {
  const checkedAt = "2026-07-07T13:16:00.000Z";
  const now = Date.parse(checkedAt) + MORNING_CONFIRM_STALE_MS;
  assert.equal(isMorningConfirmStale(checkedAt, now), false);
});

test("isMorningConfirmStale: missing/invalid timestamp never flags stale (older cached payloads)", () => {
  assert.equal(isMorningConfirmStale(undefined, Date.now()), false);
  assert.equal(isMorningConfirmStale("not-a-date", Date.now()), false);
});

test("formatCheckedAtEt: renders an Eastern clock time", () => {
  // 13:16 UTC = 9:16 AM ET in July (EDT, UTC-4).
  assert.equal(formatCheckedAtEt("2026-07-07T13:16:00.000Z"), "9:16 AM ET");
});

test("formatCheckedAtEt: invalid input degrades honestly instead of throwing/NaN", () => {
  assert.equal(formatCheckedAtEt("garbage"), "unknown time");
});

// ── PR-N6/N7 worsenPlayStatus — the one-way overnight-axes combinator ─────────────────

test("worsenPlayStatus: returns the WORSE of price vs overnight axis (one-way)", () => {
  assert.equal(worsenPlayStatus("CONFIRMED", "DEGRADED"), "DEGRADED");
  assert.equal(worsenPlayStatus("CONFIRMED", "INVALIDATED"), "INVALIDATED");
  assert.equal(worsenPlayStatus("DEGRADED", "INVALIDATED"), "INVALIDATED");
});

test("worsenPlayStatus: never UPGRADES (axis cannot improve the price grade)", () => {
  assert.equal(worsenPlayStatus("INVALIDATED", "DEGRADED"), "INVALIDATED");
  assert.equal(worsenPlayStatus("DEGRADED", "CONFIRMED"), "DEGRADED");
  assert.equal(worsenPlayStatus("INVALIDATED", "CONFIRMED"), "INVALIDATED");
});

test("worsenPlayStatus: null axis (nothing drifted) leaves the base untouched", () => {
  assert.equal(worsenPlayStatus("CONFIRMED", null), "CONFIRMED");
  assert.equal(worsenPlayStatus("DEGRADED", null), "DEGRADED");
});

test("worsenPlayStatus: UNVERIFIED (no data) is preserved — axes had no morning read to fire on", () => {
  assert.equal(worsenPlayStatus("UNVERIFIED", "INVALIDATED"), "UNVERIFIED");
  assert.equal(worsenPlayStatus("UNVERIFIED", "DEGRADED"), "UNVERIFIED");
  assert.equal(worsenPlayStatus("UNVERIFIED", null), "UNVERIFIED");
});
