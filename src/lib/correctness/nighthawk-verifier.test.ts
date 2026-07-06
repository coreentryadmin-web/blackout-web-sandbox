import { test, mock } from "node:test";
import assert from "node:assert/strict";

// nighthawk-verifier.ts's own top-level imports pull in "server-only" directly, plus @/lib/db
// (which pulls in "pg") and @/lib/nighthawk/option-chain-prompt (which pulls in the Polygon/UW
// chain providers) — mock.module() needs the RELATIVE path from THIS FILE's own location for
// every one of them (Node 20's tsx alias resolver does not run inside mock.module()'s specifier
// resolution; a "@/..." specifier there crashes with ERR_MODULE_NOT_FOUND even though it works
// under Node 22 — see docs/audit/FINDINGS.md and every sibling mock.module()-based test in this
// repo, e.g. flows-verifier.test.ts).
//
// Deliberately does NOT mock @/lib/nighthawk/play-constraints (validatePlayGeometry) or any of
// its leaf deps (./constants, ./entry-range, ./play-levels, ./types) — task #146's whole point is
// that the NEW geometry-invariant check calls the REAL publish-gate function, so these tests must
// exercise the real implementation, not a stand-in for it.
mock.module("server-only", { namedExports: {} });

const state = {
  edition: null as { edition_for: string; plays: unknown[] } | null,
  dossiers: [] as Array<{ ticker: string; dossier: Record<string, unknown>; scored: Record<string, unknown> | null }>,
};

function resetState() {
  state.edition = null;
  state.dossiers = [];
}

mock.module("../db", {
  namedExports: {
    fetchLatestNighthawkEdition: async () => state.edition,
    fetchStagedDossiers: async () => state.dossiers,
  },
});

// The L4 chain-confirm layer is irrelevant to this suite (task #146 is about the geometry
// invariant, not the chain cross-check already covered elsewhere) — stub parseOptionsContract to
// report "no parseable strike" for every play so that layer cleanly no-ops via its own existing
// "not applicable this run" path, with zero fetch/parse machinery needed.
mock.module("../nighthawk/option-chain-prompt", {
  namedExports: {
    parseOptionsContract: () => null,
    evaluatePlayAgainstChain: () => ({ verified: false, contradicted: false }),
    fetchEditionChains: async () => ({}),
  },
});

// Lazy import (ESM caches the module under test after the first call) so the mocks above are in
// place before nighthawk-verifier.ts's own top-level imports resolve — same idiom every
// mock.module()-based sibling test in this repo uses.
const mod = () => import("./nighthawk-verifier");

type Play = {
  rank: number;
  ticker: string;
  direction: string;
  conviction: string;
  play_type: "stock" | "index" | "etf";
  thesis: string;
  key_signal: string;
  entry_range: string;
  target: string;
  stop: string;
  options_play: string;
};

function play(overrides: Partial<Play> & { rank: number; ticker: string }): Play {
  return {
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

function findMetric(score: { metrics: Array<{ metric: string }> }, metric: string) {
  return score.metrics.find((m) => m.metric === metric);
}

test("geometry: a clean published edition (LONG + SHORT, both geometrically sane) is consistency-only, never a flag", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [
      play({ rank: 1, ticker: "NVDA" }), // LONG, entry 100-104, target 112.5 above, stop 96 below — sane
      play({
        rank: 2,
        ticker: "TSLA",
        direction: "SHORT",
        entry_range: "$200-$204",
        target: "$188",
        stop: "$212",
      }), // SHORT, target below entry, stop above — sane
    ],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.ok(geometry, "geometry metric must be present");
  assert.equal(geometry!.status, "consistency-only", `expected consistency-only, got: ${JSON.stringify(geometry!.checks)}`);
  assert.equal(geometry!.checks[0]!.expected, 0);
  assert.equal(geometry!.checks[0]!.actual, 0);
  assert.match(geometry!.checks[0]!.detail, /satisfy validatePlayGeometry's direction-aware geometry gate/);
});

test("geometry: a published LONG whose persisted target sits BELOW entry is FLAGGED (post-publish drift the gate should have caught)", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [
      // Same self-contradicting shape play-geometry.test.ts proves validatePlayGeometry() itself
      // drops at publish time ("LONG with target BELOW entry is dropped") — here it is already
      // PUBLISHED (as if the gate were bypassed, or the level got corrupted after), and this new
      // layer must catch it on re-read.
      play({ rank: 1, ticker: "AAPL", target: "$95" }),
    ],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.ok(geometry, "geometry metric must be present");
  assert.equal(geometry!.status, "flag");
  assert.equal(geometry!.checks[0]!.expected, 0);
  assert.equal(geometry!.checks[0]!.actual, 1);
  assert.match(geometry!.checks[0]!.detail, /AAPL/);
  assert.match(geometry!.checks[0]!.detail, /not above entry mid/);
  // The ticker-level roll-up must surface the flag (worstStatus picks it up).
  assert.equal(score.status, "flag");
});

test("geometry: the corrupt entry-range class (PR #207: low=17 against a ~$450 name) is FLAGGED post-publish", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [play({ rank: 1, ticker: "META", entry_range: "$17-$452", target: "$470", stop: "$440" })],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.equal(geometry!.status, "flag");
  assert.equal(geometry!.checks[0]!.actual, 1);
  assert.match(geometry!.checks[0]!.detail, /META/);
  assert.match(geometry!.checks[0]!.detail, /corrupt/);
});

test("geometry: an unparseable persisted target/stop (unreadable risk plan) is FLAGGED, not silently skipped", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [play({ rank: 1, ticker: "AMD", target: "see levels", stop: "-" })],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.equal(geometry!.status, "flag");
  assert.equal(geometry!.checks[0]!.actual, 1);
  assert.match(geometry!.checks[0]!.detail, /AMD/);
});

test("geometry: one bad play among several good ones is counted exactly once and named in the detail", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [
      play({ rank: 1, ticker: "NVDA" }),
      play({ rank: 2, ticker: "AMD", stop: "$108" }), // stop ABOVE entry mid — LONG violation
      play({
        rank: 3,
        ticker: "XOM",
        direction: "SHORT",
        entry_range: "$110-$114",
        target: "$102",
        stop: "$118",
      }),
    ],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.equal(geometry!.status, "flag");
  assert.equal(geometry!.checks[0]!.actual, 1);
  assert.match(geometry!.checks[0]!.detail, /AMD/);
  assert.doesNotMatch(geometry!.checks[0]!.detail, /NVDA/);
  assert.doesNotMatch(geometry!.checks[0]!.detail, /XOM/);
});

test("geometry: a prose-only entry with a sane numeric target/stop is NOT flagged (soft flag, not a hard drop)", async () => {
  const { verifyNightHawk } = await mod();
  resetState();
  state.edition = {
    edition_for: "2026-07-05",
    plays: [play({ rank: 1, ticker: "SPY", entry_range: "Break and hold above VWAP" })],
  };

  const score = await verifyNightHawk(false);

  const geometry = findMetric(score, "geometry");
  assert.equal(geometry!.status, "consistency-only");
  assert.equal(geometry!.checks[0]!.actual, 0);
});
