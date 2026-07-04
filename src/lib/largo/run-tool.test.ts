import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import type { PlayOutcomeRow } from "@/lib/spx-play-outcomes";

// run-tool.ts's import graph transitively pulls in
// src/lib/providers/gex-positioning.ts (via get_positioning's
// fetchPositioningSummary), which has `import "server-only"` at its top.
// That marker package resolves to a *throwing* stub outside Next's own
// webpack "react-server" export condition (see node_modules/server-only's
// package.json exports map) — so a plain `node --test` load of run-tool.ts
// crashes at import time unless it's stubbed out here. None of the dispatch
// cases exercised by this file ever call get_positioning, so a no-op stub is
// safe.
mock.module("server-only", { namedExports: {} });

// mock.module() resolves bare specifiers relative to THIS file, not through
// the "@/" tsconfig alias (see src/app/api/platform/intel/route.test.ts) — so
// "../db" below is the same underlying src/lib/db.ts that run-tool.ts imports
// via "@/lib/db" and that spx-play-outcomes.ts dynamically re-imports the
// same way.
//
// namedExports fully REPLACES the module's exports (no merge with the real
// module — verified empirically: a static import of a name missing from the
// mock throws "does not provide an export named ..."). run-tool.ts statically
// imports several OTHER names from "@/lib/db" (fetchPendingNighthawkOutcomes,
// fetchRecentFlows, fetchStagedDossiers, fetchStagedDossierTickers) and
// spx-play-outcomes.ts imports fetchClosedPlayOutcomes — so the real module is
// imported first (inside `before`, since top-level await isn't supported by
// this project's CJS test transform) and spread, overriding only the two
// fetchers this test drives.
let mockSpxRows: PlayOutcomeRow[] = [];
let mockNighthawkRows: NighthawkPlayOutcomeRow[] = [];
let mockNighthawkPendingCount = 0;
let capturedNighthawkWindow: number | null = null;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function spxRow(overrides: Partial<PlayOutcomeRow>): PlayOutcomeRow {
  return {
    id: 1,
    open_play_id: 1,
    session_date: "2026-06-30",
    direction: "long",
    entry_path: "cold_buy",
    grade: "A",
    score: 80,
    confidence: 0.8,
    entry_price: 5500,
    exit_price: 5510,
    stop: 5490,
    target: 5520,
    mfe_pts: 12,
    mae_pts: 3,
    trim_done: false,
    pnl_pts: 10,
    outcome: "win",
    exit_action: "TARGET",
    headline: "SPX cold buy",
    opened_at: daysAgo(1),
    closed_at: daysAgo(1),
    ...overrides,
  };
}

function nighthawkRow(overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-06-30",
    ticker: "AAPL",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 200,
    entry_range_high: 202,
    target: 210,
    stop: 195,
    score: 75,
    sector: "Tech",
    next_day_open: 201,
    next_day_close: 209,
    session_high: 211,
    session_low: 199,
    hit_target: true,
    hit_stop: false,
    outcome: "target",
    created_at: "2026-06-30T09:00:00Z",
    ...overrides,
  };
}

describe("runLargoTool: get_spx_vs_nighthawk_comparison", () => {
  let runLargoTool: typeof import("./run-tool").runLargoTool;

  before(async () => {
    const realDb = await import("../db");
    mock.module("../db", {
      namedExports: {
        ...realDb,
        fetchClosedPlayOutcomes: async (_limit: number) => mockSpxRows,
        fetchNighthawkOutcomeAnalytics: async (windowDays: number) => {
          capturedNighthawkWindow = windowDays;
          return { rows: mockNighthawkRows, pending_count: mockNighthawkPendingCount };
        },
      },
    });
    ({ runLargoTool } = await import("./run-tool"));
  });

  test("computes each product's win rate over the SAME rolling window plus a correct pre-computed delta", async () => {
    // SPX Slayer: 4 closed rows, but only 3 fall inside a 7-day window — the
    // 10-day-old row must be excluded by fetchPlayOutcomeStatsForWindow's own
    // day-cutoff filtering, not left to the caller.
    mockSpxRows = [
      spxRow({ id: 1, outcome: "win", closed_at: daysAgo(2) }),
      spxRow({ id: 2, outcome: "win", closed_at: daysAgo(3) }),
      spxRow({ id: 3, outcome: "loss", closed_at: daysAgo(5) }),
      spxRow({ id: 4, outcome: "win", closed_at: daysAgo(10) }), // outside the 7d window
    ];
    // Night Hawk: fetchNighthawkOutcomeAnalytics is mocked directly (its own
    // SQL already applies the day window in production) — 1 target (win),
    // 1 stop (loss), 1 still-open (excluded from the rate denominator).
    mockNighthawkRows = [
      nighthawkRow({ id: 1, outcome: "target" }),
      nighthawkRow({ id: 2, outcome: "stop" }),
      nighthawkRow({ id: 3, outcome: "open" }),
    ];
    mockNighthawkPendingCount = 2;

    const result = (await runLargoTool("get_spx_vs_nighthawk_comparison", { days: 7 })) as Record<
      string,
      unknown
    >;

    assert.equal(result.days, 7);
    assert.equal(capturedNighthawkWindow, 7);

    // SPX: 2 wins / 3 in-window closed plays (the 10d-old row is excluded).
    assert.equal(result.spx_signal_count, 3);
    assert.equal(result.spx_wins, 2);
    assert.equal(result.spx_losses, 1);
    assert.equal(result.spx_breakeven, 0);
    assert.equal(result.spx_win_rate, 2 / 3);

    // Night Hawk: 1 win / (1 win + 1 loss) decided plays; the "open" row
    // counts toward signal_count but not the win-rate denominator.
    assert.equal(result.nighthawk_signal_count, 3);
    assert.equal(result.nighthawk_wins, 1);
    assert.equal(result.nighthawk_losses, 1);
    assert.equal(result.nighthawk_pending_count, 2);
    assert.equal(result.nighthawk_win_rate, 0.5);

    // The whole point of this tool: the delta is pre-computed once, in code,
    // using the exact same win_rate/signal_count values returned above —
    // never left for the model to subtract itself.
    assert.equal(result.win_rate_delta, 2 / 3 - 0.5);
    assert.equal(result.signal_count_delta, 3 - 3);
  });

  test("defaults to a 7-day rolling window when days is omitted", async () => {
    mockSpxRows = [];
    mockNighthawkRows = [];
    mockNighthawkPendingCount = 0;

    const result = (await runLargoTool("get_spx_vs_nighthawk_comparison", {})) as Record<
      string,
      unknown
    >;

    assert.equal(result.days, 7);
    assert.equal(capturedNighthawkWindow, 7);
    // No data either side — both win rates are honestly 0, not NaN/Infinity.
    assert.equal(result.spx_win_rate, 0);
    assert.equal(result.nighthawk_win_rate, 0);
    assert.equal(result.win_rate_delta, 0);
  });

  test("clamps a bogus days value instead of forwarding it to the DB layer unchecked", async () => {
    mockSpxRows = [];
    mockNighthawkRows = [];
    mockNighthawkPendingCount = 0;

    const tooLarge = (await runLargoTool("get_spx_vs_nighthawk_comparison", {
      days: 9000,
    })) as Record<string, unknown>;
    assert.equal(tooLarge.days, 180);
    assert.equal(capturedNighthawkWindow, 180);

    const nonNumeric = (await runLargoTool("get_spx_vs_nighthawk_comparison", {
      days: "not-a-number",
    })) as Record<string, unknown>;
    assert.equal(nonNumeric.days, 7);
    assert.equal(capturedNighthawkWindow, 7);
  });
});
