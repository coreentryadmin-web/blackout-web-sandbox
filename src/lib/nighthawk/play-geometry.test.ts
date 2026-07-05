import assert from "node:assert/strict";
import test from "node:test";
import { validatePlayGeometry, capSectorConcentration } from "./play-constraints";
import { convictionRank } from "./scorer";
import type { PlaybookPlay } from "./types";

// Publish-time trade-geometry gate (2026-07-02 audit HIGH): entry/target/stop reached
// members with no numeric validation anywhere in the publish path.

function play(overrides: Partial<PlaybookPlay>): PlaybookPlay {
  return {
    rank: 1,
    ticker: "TEST",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$100-$104",
    target: "$112.50",
    stop: "$96",
    options_play: "TEST 110C 08/21",
    ...overrides,
  };
}

test("geometry: a sane LONG passes", () => {
  const v = validatePlayGeometry(play({}));
  assert.equal(v.ok, true);
  assert.equal(v.drops.length, 0);
});

test("geometry: a sane SHORT passes (target below, stop above)", () => {
  const v = validatePlayGeometry(
    play({ direction: "SHORT", entry_range: "$200-$204", target: "$188", stop: "$212" })
  );
  assert.equal(v.ok, true);
});

test("geometry: LONG with target BELOW entry is dropped", () => {
  const v = validatePlayGeometry(play({ target: "$95" }));
  assert.equal(v.ok, false);
  assert.ok(v.drops.some((d) => d.includes("not above entry mid")));
});

test("geometry: LONG with stop ABOVE entry is dropped (same-side stop)", () => {
  const v = validatePlayGeometry(play({ stop: "$108" }));
  assert.equal(v.ok, false);
  assert.ok(v.drops.some((d) => d.includes("not below entry mid")));
});

test("geometry: SHORT with target ABOVE entry is dropped", () => {
  const v = validatePlayGeometry(
    play({ direction: "SHORT", entry_range: "$200-$204", target: "$215", stop: "$212" })
  );
  assert.equal(v.ok, false);
});

test("geometry: the corrupt entry-range class (#207) is dropped at publish now", () => {
  // The canonical live corruption: low=17 against a ~$450 name — width >> 20% of mid.
  const v = validatePlayGeometry(play({ entry_range: "$17-$452", target: "$470", stop: "$440" }));
  assert.equal(v.ok, false);
  assert.ok(v.drops.some((d) => d.includes("corrupt")));
});

test("geometry: unparseable target/stop is dropped (unreadable risk plan)", () => {
  const v = validatePlayGeometry(play({ target: "see levels", stop: "-" }));
  assert.equal(v.ok, false);
  assert.equal(v.drops.length, 2);
});

test("geometry: prose-only entry with sane target/stop is kept but flagged", () => {
  const v = validatePlayGeometry(
    play({ entry_range: "Break and hold above VWAP", target: "$112.50", stop: "$96" })
  );
  assert.equal(v.ok, true);
  assert.ok(v.flags.length >= 1);
});

test("geometry: conditional prose + numeric band validates against the band", () => {
  // mapClaudePlayToEdition joins entry_condition and entry_range: "prose | $100-$104"
  const v = validatePlayGeometry(play({ entry_range: "Break above 99 | $100-$104" }));
  // parsePlayLevels reads the numeric tokens; target 112.5 above, stop 96 below → ok
  assert.equal(v.ok, true);
});

// ── sector concentration cap ─────────────────────────────────────────────────────

test("sector cap: third same-sector play is dropped, other sectors backfill", () => {
  const plays = [
    play({ ticker: "NVDA", rank: 1 }),
    play({ ticker: "AVGO", rank: 2 }),
    play({ ticker: "AMD", rank: 3 }),
    play({ ticker: "XOM", rank: 4 }),
  ];
  const sectors = { NVDA: "semis", AVGO: "semis", AMD: "semis", XOM: "energy" };
  const { plays: kept, dropped } = capSectorConcentration(plays, sectors, 2);
  assert.deepEqual(kept.map((p) => p.ticker), ["NVDA", "AVGO", "XOM"]);
  // task #141: `dropped` now also carries `filled` (the sector's count when AMD was
  // dropped — semis already had 2, NVDA + AVGO) and the full rejected `play` object, so
  // a durable rejection-audit row can be built without re-deriving either from `plays`.
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]!.ticker, "AMD");
  assert.equal(dropped[0]!.sector, "semis");
  assert.equal(dropped[0]!.filled, 2);
  assert.equal(dropped[0]!.play.ticker, "AMD");
});

test("sector cap: unknown sector is exempt", () => {
  const plays = [play({ ticker: "AAA" }), play({ ticker: "BBB" }), play({ ticker: "CCC" })];
  const { plays: kept } = capSectorConcentration(plays, {}, 2);
  assert.equal(kept.length, 3);
});

// ── conviction rank (pinning support) ────────────────────────────────────────────

test("convictionRank orders A+ > A > B > C; unknown reads as B", () => {
  assert.ok(convictionRank("A+") > convictionRank("A"));
  assert.ok(convictionRank("A") > convictionRank("B"));
  assert.ok(convictionRank("B") > convictionRank("C"));
  assert.equal(convictionRank("weird"), convictionRank("B"));
});
