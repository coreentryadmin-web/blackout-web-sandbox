import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { PlatformIntelSnapshot } from "./platform-intel-snapshot";
import { isPremarketBriefFresh } from "@/lib/providers/spx-session";
import type { PlayOutcomeRow } from "@/features/spx/lib/spx-play-outcomes";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

// Regression: fetchPlatformIntelSnapshot() feeds last_brief straight into
// formatPlatformIntelForPrompt() (AI/cron context), from the same
// platform_briefs "last one wins" query as /api/brief/premarket and
// /api/platform/intel — but never gated it on isPremarketBriefFresh(), so a
// brief 2+ sessions stale kept reaching cron/AI decisioning here too.
//
// Also covers a second, separate regression: signal_recommendation used to be computed by
// JOINing signal_events/signal_outcomes (004_god_tier_features.sql), a bridge table that has
// never received a single write in production (nothing calls POST /api/signals/record
// outside its own route file) — so that JOIN always returned zero rows and
// signal_recommendation was permanently null/CAUTION-only. It's now computed for real from
// spx_play_outcomes + nighthawk_play_outcomes (src/lib/signal-accuracy.ts, shared with
// /api/platform/intel/route.ts) — the tests below prove that with fixture rows standing in
// for those two real ledgers.
//
// dbQuery is mocked once, reading a mutable `mockBriefDate` at call time (not
// re-mocked per test) since ESM caches this module on first import — see
// src/app/api/platform/intel/route.test.ts for the same pattern.

const emptyRows = { rows: [], rowCount: 0 };
const briefRow = (brief_date: string) => ({
  brief_date,
  call_wall: 7550,
  put_wall: 7450,
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
  ...overrides,
});

mock.module("../../../lib/db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (sql: string) =>
      /platform_briefs/.test(sql) && mockBriefDate
        ? { rows: [briefRow(mockBriefDate)], rowCount: 1 }
        : emptyRows,
    // fetchSignalAccuracyBySource() (src/lib/signal-accuracy.ts) reads these two real-ledger
    // fetchers instead of the dead signal_events/signal_outcomes join — read the mutable
    // fixtures above at call time (same pattern as mockBriefDate).
    fetchClosedPlayOutcomes: async () => mockSpxClosedRows,
    fetchNighthawkOutcomeAnalytics: async () => ({ rows: mockNighthawkRows, pending_count: 0 }),
  },
});
mock.module("../../../lib/providers/spx-session", {
  namedExports: { isPremarketBriefFresh, todayEtYmd: () => "2026-07-01" },
});

describe("fetchPlatformIntelSnapshot last_brief staleness", () => {
  let fetchPlatformIntelSnapshot: () => Promise<PlatformIntelSnapshot>;

  before(async () => {
    ({ fetchPlatformIntelSnapshot } = await import("./platform-intel-snapshot"));
  });

  test("last_brief is null when the stored premarket brief is 2+ sessions stale", async () => {
    mockBriefDate = "2026-06-29"; // 2 days before the mocked "today"
    const snapshot = await fetchPlatformIntelSnapshot();
    assert.equal(snapshot.last_brief, null);
  });

  test("last_brief is populated when the stored premarket brief is fresh (1 day prior allowance)", async () => {
    mockBriefDate = "2026-06-30"; // 1 day before the mocked "today" — still fresh
    const snapshot = await fetchPlatformIntelSnapshot();
    assert.equal(snapshot.last_brief?.call_wall, 7550);
  });
});

describe("fetchPlatformIntelSnapshot signal_recommendation — real numbers from the live ledgers", () => {
  let fetchPlatformIntelSnapshot: () => Promise<PlatformIntelSnapshot>;

  before(async () => {
    ({ fetchPlatformIntelSnapshot } = await import("./platform-intel-snapshot"));
  });

  test("signal_recommendation reports a real, favorable blended win rate instead of staying null", async () => {
    // SPX Slayer: 6 wins / 2 losses (8 closed). Night Hawk: 2 target / 2 stop (4 scoreable).
    // Blended: 8 wins / 12 total = 66.7% — clears MIN_SAMPLE_FOR_RECOMMENDATION (10).
    mockSpxClosedRows = [
      ...Array.from({ length: 6 }, () => spxRow({ outcome: "win" })),
      ...Array.from({ length: 2 }, () => spxRow({ outcome: "loss" })),
    ];
    mockNighthawkRows = [
      ...Array.from({ length: 2 }, () => nhRow({ outcome: "target" })),
      ...Array.from({ length: 2 }, () => nhRow({ outcome: "stop" })),
    ];
    mockBriefDate = null;

    const snapshot = await fetchPlatformIntelSnapshot();
    assert.match(snapshot.signal_recommendation ?? "", /NORMAL SIZE/);
    assert.match(snapshot.signal_recommendation ?? "", /66\.7%/);
    assert.match(snapshot.signal_recommendation ?? "", /12 closed plays/);
  });

  test("signal_recommendation reports REDUCE SIZE for a real but unfavorable blended win rate", async () => {
    // 3 wins / 9 losses = 25% across 12 closed — clears the sample bar, below 50%.
    mockSpxClosedRows = [
      ...Array.from({ length: 3 }, () => spxRow({ outcome: "win" })),
      ...Array.from({ length: 9 }, () => spxRow({ outcome: "loss" })),
    ];
    mockNighthawkRows = [];

    const snapshot = await fetchPlatformIntelSnapshot();
    assert.match(snapshot.signal_recommendation ?? "", /REDUCE SIZE/);
    assert.match(snapshot.signal_recommendation ?? "", /25%/);
  });

  test("signal_recommendation stays null below the minimum sample size (not a fabricated 0%)", async () => {
    // Only 2 closed plays total — below MIN_SAMPLE_FOR_RECOMMENDATION (10) and no anomalies.
    mockSpxClosedRows = [spxRow({ outcome: "win" }), spxRow({ outcome: "loss" })];
    mockNighthawkRows = [];

    const snapshot = await fetchPlatformIntelSnapshot();
    assert.equal(snapshot.signal_recommendation, null);
  });
});
