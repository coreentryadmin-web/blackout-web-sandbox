import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { isPremarketBriefFresh } from "../../../../lib/providers/spx-session";
import type { PlayOutcomeRow } from "../../../../lib/spx-play-outcomes";
import type { NighthawkPlayOutcomeRow } from "../../../../lib/db";

// Regression: /api/platform/intel fed a "last brief" of unknown age straight to
// crons and AI prompt context via lastBrief — /api/brief/premarket gates this
// with isPremarketBriefFresh() (see spx-session.ts), but this sibling endpoint
// (same platform_briefs table, same "last one wins" query) never did, so a
// brief 2+ sessions stale kept getting served here even after that fix.
//
// Also covers a second, separate regression: signalAccuracy/regimeAccuracy used to be
// computed by JOINing signal_events/signal_outcomes (004_god_tier_features.sql), a bridge
// table that has never received a single write in production (nothing calls
// POST /api/signals/record outside its own route file) — so that JOIN always returned zero
// rows and intelligence.signalRecommendation was permanently stuck on "INSUFFICIENT DATA".
// signalAccuracy/currentRegimeProfitable/signalRecommendation are now computed for real from
// spx_play_outcomes + nighthawk_play_outcomes (src/lib/signal-accuracy.ts) — the tests below
// prove that with fixture rows standing in for those two real ledgers.
//
// mock.module() resolves bare specifiers relative to this file, not through the
// "@/" tsconfig alias — see src/lib/__tests__/critical-api-routes.test.ts. And
// since ESM caches a module on first import, re-importing "./route" per test
// would keep replaying the FIRST mock's dbQuery forever — so dbQuery is mocked
// once, reading a mutable `mockBriefDate` at call time, and route.ts is
// imported once in `before()`.

const emptyRows = { rows: [], rowCount: 0 };
const briefRow = (brief_date: string) => ({
  brief_date,
  brief_type: "premarket",
  published_at: "2026-06-30T09:00:00Z",
  spx_price: 7499.36,
  call_wall: 7550,
  put_wall: 7450,
  king_strike: 7500,
  net_gex: 1_000_000,
  gex_bias: "long",
});

let mockBriefDate: string | null = null;
// Stand in for the real spx_play_outcomes / nighthawk_play_outcomes ledgers that
// fetchSignalAccuracyBySource() (src/lib/signal-accuracy.ts) reads.
let mockSpxClosedRows: PlayOutcomeRow[] = [];
let mockNighthawkRows: NighthawkPlayOutcomeRow[] = [];

const spxRow = (overrides: Partial<PlayOutcomeRow>): PlayOutcomeRow => ({
  id: 1,
  open_play_id: 1,
  session_date: "2026-06-01",
  direction: "long",
  entry_path: "cold_buy",
  grade: "A",
  score: 80,
  confidence: 0.8,
  entry_price: 6000,
  exit_price: 6010,
  stop: 5990,
  target: 6020,
  mfe_pts: 12,
  mae_pts: 4,
  trim_done: false,
  pnl_pts: 10,
  outcome: "win",
  exit_action: "TARGET",
  headline: "test",
  opened_at: "2026-06-01T14:00:00.000Z",
  closed_at: "2026-06-01T15:00:00.000Z",
  ...overrides,
});

const nhRow = (overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow => ({
  id: 1,
  edition_for: "2026-06-30",
  ticker: "AAPL",
  direction: "LONG",
  conviction: "A",
  entry_range_low: 448,
  entry_range_high: 452,
  target: 460,
  stop: 440,
  score: 70,
  sector: "Tech",
  next_day_open: 450,
  next_day_close: 455,
  session_high: 456,
  session_low: 449,
  hit_target: false,
  hit_stop: false,
  outcome: "target",
  created_at: "2026-06-30T09:00:00Z",
  // PR-N2: current-methodology by default — legacy-tagged grades are quarantined out
  // of every surface behind isNighthawkOutcomeScoreable, incl. signal accuracy here.
  grade_methodology: "v2_fillability",
  ...overrides,
});

mock.module("../../../../lib/db", {
  namedExports: {
    dbQuery: async (sql: string) =>
      /platform_briefs/.test(sql) && mockBriefDate
        ? { rows: [briefRow(mockBriefDate)], rowCount: 1 }
        : emptyRows,
    // fetchSignalAccuracyBySource() (src/lib/signal-accuracy.ts) reads these two real-ledger
    // fetchers instead of the dead signal_events/signal_outcomes join — read the mutable
    // fixtures above at call time (same pattern as mockBriefDate) so later tests can prove
    // real accuracy numbers without re-registering the module mock.
    dbConfigured: () => true,
    fetchClosedPlayOutcomes: async () => mockSpxClosedRows,
    fetchNighthawkOutcomeAnalytics: async () => ({ rows: mockNighthawkRows, pending_count: 0 }),
  },
});
mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../lib/providers/spx-session", {
  namedExports: { isPremarketBriefFresh, todayEtYmd: () => "2026-07-01" },
});

describe("/api/platform/intel lastBrief staleness", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("lastBrief is null when the stored premarket brief is 2+ sessions stale", async () => {
    mockBriefDate = "2026-06-29"; // 2 days before the mocked "today"
    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();
    assert.equal(json.lastBrief, null);
  });

  test("lastBrief is populated when the stored premarket brief is fresh (1 day prior allowance)", async () => {
    mockBriefDate = "2026-06-30"; // 1 day before the mocked "today" — still fresh
    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();
    assert.equal(json.lastBrief?.callWall, 7550);
  });

  test("lastBrief is null when there is no brief row at all", async () => {
    mockBriefDate = null;
    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();
    assert.equal(json.lastBrief, null);
  });
});

describe("/api/platform/intel signalAccuracy — real numbers from the live ledgers", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("signalAccuracy + signalRecommendation reflect a real, favorable blended win rate", async () => {
    // SPX Slayer: 5 wins / 3 losses (8 closed). Night Hawk: 3 target / 1 stop (4 scoreable).
    // Blended: 8 wins / 12 total = 66.7% — clears MIN_SAMPLE_FOR_RECOMMENDATION (10).
    mockSpxClosedRows = [
      ...Array.from({ length: 5 }, () => spxRow({ outcome: "win" })),
      ...Array.from({ length: 3 }, () => spxRow({ outcome: "loss" })),
    ];
    mockNighthawkRows = [
      ...Array.from({ length: 3 }, () => nhRow({ outcome: "target" })),
      nhRow({ outcome: "stop" }),
    ];

    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();

    assert.deepEqual(json.signalAccuracy, {
      SPX_SLAYER: { total: 8, wins: 5, winRate: 62.5 },
      NIGHT_HAWK: { total: 4, wins: 3, winRate: 75 },
    });
    // regimeAccuracy is intentionally empty — see src/lib/signal-accuracy.ts: neither real
    // ledger tags an outcome with the market regime active at entry.
    assert.deepEqual(json.regimeAccuracy, []);
    assert.equal(json.intelligence.currentRegimeProfitable, true);
    assert.match(json.intelligence.signalRecommendation, /NORMAL SIZE/);
    assert.match(json.intelligence.signalRecommendation, /66\.7%/);
    assert.match(json.intelligence.signalRecommendation, /12 closed plays/);
  });

  test("signalRecommendation says REDUCE SIZE for a real but unfavorable blended win rate", async () => {
    // 3 wins / 9 losses = 25% across 12 closed — clears the sample bar, below 50%.
    mockSpxClosedRows = [
      ...Array.from({ length: 3 }, () => spxRow({ outcome: "win" })),
      ...Array.from({ length: 9 }, () => spxRow({ outcome: "loss" })),
    ];
    mockNighthawkRows = [];

    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();

    assert.equal(json.signalAccuracy.SPX_SLAYER.winRate, 25);
    assert.equal(json.intelligence.currentRegimeProfitable, false);
    assert.match(json.intelligence.signalRecommendation, /REDUCE SIZE/);
    assert.match(json.intelligence.signalRecommendation, /25%/);
  });

  test("signalRecommendation stays INSUFFICIENT DATA below the minimum sample size (not a fabricated 0%)", async () => {
    // Only 2 closed plays total — below MIN_SAMPLE_FOR_RECOMMENDATION (10).
    mockSpxClosedRows = [spxRow({ outcome: "win" }), spxRow({ outcome: "loss" })];
    mockNighthawkRows = [];

    const res = await GET(new Request("http://localhost/api/platform/intel") as NextRequest);
    const json = await res.json();

    assert.equal(json.signalAccuracy.SPX_SLAYER.total, 2);
    assert.equal(json.intelligence.currentRegimeProfitable, null);
    assert.match(json.intelligence.signalRecommendation, /INSUFFICIENT DATA/);
  });
});
