import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// mock.module() must be registered before ecosystem-context.ts (and therefore
// its "@/lib/db" import) is ever loaded — an ordinary top-level `import` of
// ecosystem-context here would resolve the real db.ts first (ES module
// imports are hoisted ahead of any other module-body code, including a
// mock.module() call written textually above them). So everything under test
// is loaded dynamically inside `before()` instead, same pattern as
// src/lib/nighthawk/platform-intel-snapshot.test.ts.

const emptyRows = { rows: [], rowCount: 0 };

let mockOpenPlay: Record<string, unknown> | null = null;
let mockClosedRows: Record<string, unknown>[] = [];
let openPlayCalls = 0;
let closedPlayCalls = 0;

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    // The 5 pre-existing ecosystem-context queries (zerodte/nighthawk/audit/
    // flow/anomalies) all go through dbQuery — none of them matter for the
    // spx_play assertions below, so a single empty-rows stub covers all of them.
    dbQuery: async () => emptyRows,
    fetchOpenSpxPlay: async () => {
      openPlayCalls++;
      return mockOpenPlay;
    },
    fetchClosedPlayOutcomes: async () => {
      closedPlayCalls++;
      return mockClosedRows;
    },
  },
});

let fetchEcosystemContext: typeof import("./ecosystem-context").fetchEcosystemContext;
let ECOSYSTEM_CONTEXT_FIELDS: typeof import("./ecosystem-context").ECOSYSTEM_CONTEXT_FIELDS;
let mapNighthawkEchoRows: typeof import("./ecosystem-context").mapNighthawkEchoRows;

before(async () => {
  ({ fetchEcosystemContext, ECOSYSTEM_CONTEXT_FIELDS, mapNighthawkEchoRows } = await import("./ecosystem-context"));
});

test("ECOSYSTEM_CONTEXT_FIELDS: covers every real field with a non-empty description", () => {
  const expected = [
    "zerodte_today",
    "nighthawk_recent",
    "recent_audit_entries",
    "recent_flow",
    "recent_anomalies",
    "spx_play",
    "flow_feed_fresh",
  ];
  assert.deepEqual(
    ECOSYSTEM_CONTEXT_FIELDS.map((f) => f.field).sort(),
    [...expected].sort()
  );
  for (const f of ECOSYSTEM_CONTEXT_FIELDS) {
    assert.ok(f.description.length > 10, `${f.field} needs a real description, not a stub`);
  }
});

// Regression: fetchEcosystemContext() read zerodte_setup_log, nighthawk_play_outcomes,
// alert_audit_log, flow_alerts and flow_anomalies but never SPX Slayer's own
// spx_open_play/spx_play_outcomes tables — so this cross-instrument snapshot's
// own play engine was invisible to itself. spx_play closes that gap by reusing
// the exact fetchOpenSpxPlay/fetchClosedPlayOutcomes fetchers spx-service.ts
// already calls, scoped to SPX/SPXW only since those tables carry no ticker column.

test('fetchEcosystemContext("SPX"): spx_play.open_play is populated when an open play exists', async () => {
  openPlayCalls = 0;
  closedPlayCalls = 0;
  mockOpenPlay = {
    id: 1,
    session_date: "2026-07-04",
    direction: "long",
    entry_price: 5500,
    entry_score: 80,
    stop: 5480,
    target: 5550,
    grade: "A",
    headline: "SPX cold buy long",
    trim_done: false,
    mfe_pts: 10,
    mae_pts: 2,
    opened_at: "2026-07-04T14:35:00.000Z",
    status: "open",
  };
  mockClosedRows = [];

  const ctx = await fetchEcosystemContext("SPX");
  assert.ok(openPlayCalls > 0, "fetchOpenSpxPlay should run for ticker SPX");
  assert.deepEqual(ctx.spx_play, {
    open_play: {
      direction: "long",
      grade: "A",
      entry_price: 5500,
      stop: 5480,
      target: 5550,
      headline: "SPX cold buy long",
      status: "open",
      opened_at: "2026-07-04T14:35:00.000Z",
    },
    last_closed: null,
  });
});

test('fetchEcosystemContext("SPXW"): spx_play.last_closed reflects the most recent closed play', async () => {
  mockOpenPlay = null;
  mockClosedRows = [
    {
      id: 2,
      open_play_id: 1,
      session_date: "2026-07-03",
      direction: "short",
      entry_path: "cold_buy",
      grade: "B",
      score: 60,
      confidence: 70,
      entry_price: 5600,
      exit_price: 5580,
      stop: 5620,
      target: 5560,
      mfe_pts: 25,
      mae_pts: 5,
      trim_done: true,
      pnl_pts: 20,
      outcome: "win",
      exit_action: "TARGET",
      headline: "SPX watch promote short",
      opened_at: "2026-07-03T15:00:00.000Z",
      closed_at: "2026-07-03T15:40:00.000Z",
    },
  ];

  // SPXW (0DTE weeklies) shares the same single-instrument engine as SPX.
  const ctx = await fetchEcosystemContext("SPXW");
  assert.deepEqual(ctx.spx_play, {
    open_play: null,
    last_closed: {
      direction: "short",
      grade: "B",
      entry_price: 5600,
      exit_price: 5580,
      pnl_pts: 20,
      outcome: "win",
      headline: "SPX watch promote short",
      closed_at: "2026-07-03T15:40:00.000Z",
    },
  });
});

test("fetchEcosystemContext: spx_play is null for a non-SPX ticker, and the SPX-only fetchers never run", async () => {
  openPlayCalls = 0;
  closedPlayCalls = 0;
  // Deliberately leave an open play mocked to prove the ticker gate — not the
  // data — is what keeps a non-SPX ticker's spx_play null.
  mockOpenPlay = {
    id: 3,
    session_date: "2026-07-04",
    direction: "long",
    entry_price: 100,
    entry_score: 1,
    stop: null,
    target: null,
    grade: "A",
    headline: "irrelevant to AAPL",
    trim_done: false,
    mfe_pts: 0,
    mae_pts: 0,
    opened_at: "2026-07-04T10:00:00.000Z",
    status: "open",
  };
  mockClosedRows = [];

  const ctx = await fetchEcosystemContext("AAPL");
  assert.equal(ctx.spx_play, null);
  assert.equal(openPlayCalls, 0, "fetchOpenSpxPlay must not run for a non-SPX ticker");
  assert.equal(closedPlayCalls, 0, "fetchClosedPlayOutcomes must not run for a non-SPX ticker");
});

test("mapNighthawkEchoRows: maps rows keyed by uppercased ticker", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "aapl", edition_for: "2026-07-01", direction: "long", conviction: "high", outcome: "target", score: 82 },
  ]);
  assert.deepEqual(map.get("AAPL"), {
    edition_for: "2026-07-01",
    direction: "long",
    conviction: "high",
    outcome: "target",
    score: 82,
  });
});

test("mapNighthawkEchoRows: null score stays null, not 0", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "NVDA", edition_for: "2026-07-02", direction: "short", conviction: "medium", outcome: "pending", score: null },
  ]);
  assert.equal(map.get("NVDA")?.score, null);
});

test("mapNighthawkEchoRows: empty input returns empty map", () => {
  assert.equal(mapNighthawkEchoRows([]).size, 0);
});

test("mapNighthawkEchoRows: last row wins per ticker if duplicates slip through", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "TSLA", edition_for: "2026-07-01", direction: "long", conviction: "low", outcome: "stop", score: 40 },
    { ticker: "TSLA", edition_for: "2026-06-30", direction: "short", conviction: "high", outcome: "target", score: 90 },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("TSLA")?.edition_for, "2026-06-30");
});
