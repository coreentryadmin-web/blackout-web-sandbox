import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import type { PlayOutcomeRow } from "@/features/spx/lib/spx-play-outcomes";

// fetchPlayOutcomeStatsForWindow (spx-play-outcomes.ts) branches on dbConfigured()
// — with no DATABASE_URL/DATABASE_PUBLIC_URL set, it silently reads an in-memory
// fallback instead of calling the (mocked) fetchClosedPlayOutcomes below, so this
// suite would pass or fail depending on whatever ambient env the runner happens to
// have. Force the DB-configured branch so the mock is always actually exercised —
// this is a fixture value only, dbConfigured() just checks it's non-empty; the
// mocked "../db" below means nothing ever attempts a real connection.
process.env.DATABASE_URL = "postgres://test-hermetic-fixture";

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
// fetchRecentFlows, fetchStagedDossiers, fetchStagedDossierTickers,
// fetchNighthawkScoringHistory) and spx-play-outcomes.ts imports
// fetchClosedPlayOutcomes — so the real module is imported first (inside
// `before`, since top-level await isn't supported by this project's CJS test
// transform) and spread, overriding only the fetchers the describe blocks
// below actually drive.
let mockSpxRows: PlayOutcomeRow[] = [];
let mockNighthawkRows: NighthawkPlayOutcomeRow[] = [];
let mockNighthawkPendingCount = 0;
let capturedNighthawkWindow: number | null = null;

// Task #129 fixtures — get_nighthawk_dossier's live-staging + durable-archive fallback.
// Declared here (module scope, hoisted `before` below) rather than inside their own
// describe's `before` because run-tool.ts is a SINGLE module cached by Node's ESM loader
// on first dynamic import — a second `mock.module("../db", …)` call after that first
// import would never actually reach the already-resolved module graph, so every db
// override this file needs must live in the ONE shared `before` hook.
let mockStagedDossiers: Array<{
  ticker: string;
  dossier: Record<string, unknown>;
  scored: Record<string, unknown> | null;
}> = [];
let mockStagedTickers: string[] = [];
let mockScoringHistory: Array<{
  ticker: string;
  dossier: Record<string, unknown>;
  scored: Record<string, unknown> | null;
  staged_at: string;
  archived_at: string;
}> = [];

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
      fetchStagedDossiers: async (_editionFor: string) => mockStagedDossiers,
      fetchStagedDossierTickers: async (_editionFor: string) => mockStagedTickers,
      // Real fetchNighthawkScoringHistory signature: (editionFor, ticker?). Mirrors the
      // real SQL's ticker-scoped filter so a ticker-scoped call never leaks another
      // candidate's archived row.
      fetchNighthawkScoringHistory: async (_editionFor: string, ticker?: string) =>
        ticker ? mockScoringHistory.filter((h) => h.ticker === ticker) : mockScoringHistory,
    },
  });
  ({ runLargoTool } = await import("./run-tool"));
});

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
    // PR-N2: current-methodology by default — run-tool filters rows through the shared
    // isNighthawkOutcomeScoreable predicate, which quarantines legacy-tagged grades.
    grade_methodology: "v2_fillability",
    ...overrides,
  };
}

describe("runLargoTool: get_spx_vs_nighthawk_comparison", () => {
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

  test("quarantines legacy-methodology and pulled Night Hawk grades out of the quoted win rate (PR-N2)", async () => {
    mockSpxRows = [];
    // 1 honest current-rules win + 1 honest current-rules stop, PLUS a legacy phantom
    // "target" (pre-fillability grade) and a pulled would-have-won. Largo must quote
    // 50%, not 3/4 or 2/3 — the same anti-blend rule as the record strip.
    mockNighthawkRows = [
      nighthawkRow({ id: 1, outcome: "target" }),
      nighthawkRow({ id: 2, outcome: "stop" }),
      nighthawkRow({ id: 3, outcome: "target", grade_methodology: "v1_level_touch" }),
      nighthawkRow({ id: 4, outcome: "target", pulled: true }),
    ];
    mockNighthawkPendingCount = 0;

    const result = (await runLargoTool("get_spx_vs_nighthawk_comparison", { days: 7 })) as Record<
      string,
      unknown
    >;

    assert.equal(result.nighthawk_signal_count, 2);
    assert.equal(result.nighthawk_wins, 1);
    assert.equal(result.nighthawk_losses, 1);
    assert.equal(result.nighthawk_win_rate, 0.5);
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

describe("runLargoTool: get_nighthawk_dossier (task #129 durable scoring-history fallback)", () => {
  test("ticker lookup: returns the live-staged dossier when staging still has it, archived:false", async () => {
    mockStagedDossiers = [
      { ticker: "AAPL", dossier: { ticker: "AAPL", sector: "Tech" }, scored: { ticker: "AAPL", score: 82 } },
    ];
    mockScoringHistory = []; // archive not needed — should never even be consulted

    const result = (await runLargoTool("get_nighthawk_dossier", {
      date: "2026-07-05",
      ticker: "AAPL",
    })) as Record<string, unknown>;

    assert.equal(result.edition_for, "2026-07-05");
    assert.equal(result.ticker, "AAPL");
    assert.equal(result.archived, false);
    assert.deepEqual(result.dossier, {
      ticker: "AAPL",
      dossier: { ticker: "AAPL", sector: "Tech" },
      scored: { ticker: "AAPL", score: 82 },
    });
  });

  test("ticker lookup: falls back to nighthawk_scoring_history once live staging has been cleared for the edition (archived:true)", async () => {
    // Simulates the exact gap this task closes: the edition already published, so
    // clearNighthawkStaging() emptied nighthawk_dossiers_staging for this date — but
    // archiveAndClearNighthawkStaging archived it first, so the durable table still has it.
    mockStagedDossiers = [];
    mockScoringHistory = [
      {
        ticker: "TSLA",
        dossier: { ticker: "TSLA", sector: "Auto" },
        scored: { ticker: "TSLA", score: 91, fundamental_block: false },
        staged_at: "2026-07-04T23:10:00.000Z",
        archived_at: "2026-07-05T00:05:00.000Z",
      },
    ];

    const result = (await runLargoTool("get_nighthawk_dossier", {
      date: "2026-07-04",
      ticker: "TSLA",
    })) as Record<string, unknown>;

    assert.equal(result.edition_for, "2026-07-04");
    assert.equal(result.ticker, "TSLA");
    assert.equal(result.archived, true, "must flag that this answer came from the durable archive, not live staging");
    assert.deepEqual(result.dossier, {
      ticker: "TSLA",
      dossier: { ticker: "TSLA", sector: "Auto" },
      scored: { ticker: "TSLA", score: 91, fundamental_block: false },
    });
  });

  test("ticker lookup: neither live staging nor the archive has the ticker — null dossier, archived:false", async () => {
    mockStagedDossiers = [];
    mockScoringHistory = [];

    const result = (await runLargoTool("get_nighthawk_dossier", {
      date: "2026-07-04",
      ticker: "NVDA",
    })) as Record<string, unknown>;

    assert.equal(result.dossier, null);
    assert.equal(result.archived, false);
  });

  test("no-ticker listing: returns live-staged tickers when staging is still populated, archived:false", async () => {
    mockStagedDossiers = [];
    mockStagedTickers = ["AAPL", "MSFT"];
    mockScoringHistory = [];

    const result = (await runLargoTool("get_nighthawk_dossier", { date: "2026-07-05" })) as Record<string, unknown>;

    assert.deepEqual(result.tickers, ["AAPL", "MSFT"]);
    assert.equal(result.archived, false);
  });

  test("no-ticker listing: falls back to the archived tickers once live staging is empty for the edition (archived:true)", async () => {
    mockStagedTickers = [];
    mockScoringHistory = [
      {
        ticker: "AAPL",
        dossier: {},
        scored: null,
        staged_at: "2026-07-04T23:00:00.000Z",
        archived_at: "2026-07-05T00:05:00.000Z",
      },
      {
        ticker: "TSLA",
        dossier: {},
        scored: null,
        staged_at: "2026-07-04T23:01:00.000Z",
        archived_at: "2026-07-05T00:05:00.000Z",
      },
    ];

    const result = (await runLargoTool("get_nighthawk_dossier", { date: "2026-07-04" })) as Record<string, unknown>;

    assert.deepEqual(result.tickers, ["AAPL", "TSLA"]);
    assert.equal(result.archived, true);
  });

  test("no-ticker listing: neither staging nor archive has anything for this edition — empty list, archived:false", async () => {
    mockStagedTickers = [];
    mockScoringHistory = [];

    const result = (await runLargoTool("get_nighthawk_dossier", { date: "2026-07-04" })) as Record<string, unknown>;

    assert.deepEqual(result.tickers, []);
    assert.equal(result.archived, false);
  });
});
