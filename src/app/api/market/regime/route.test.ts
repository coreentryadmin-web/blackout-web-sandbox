import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { formatEtDate } from "@/features/nighthawk/lib/session";

// Task #173: /api/market/regime's GET had two bugs, both fixed here.
//
// Bug A (staleness): the route always returned `available: true` for whatever the
// most recent market_regime row was, with `capturedAt` present but nothing telling
// the client the data wasn't live. Confirmed live: a Fri 2026-07-03 (July-4th-observed
// holiday) capture was still served `available: true` on Sun 2026-07-05, ~49h later.
// `stale`/`marketOpen` are now additive fields computed from the row's captured_at vs.
// mostRecentTradingDayEt() / isEtCashRth().
//
// Bug B (netGex/ivPercentile unrounded): net_gex/iv_percentile are Postgres NUMERIC
// columns, which node-postgres returns as full-precision STRINGS, never numbers —
// these were serialized verbatim (e.g. "7730543991.5...93") instead of going through
// this codebase's roundFloats() convention (used on gex-heatmap/gex-positioning).
//
// mock.module() resolves bare specifiers relative to THIS file (not the "@/" tsconfig
// alias) — see src/app/api/platform/intel/route.test.ts for the same pattern.
// `formatEtDate` is imported for real (pure, no need to fake) and passed through in
// the nighthawk/session mock below; only `mostRecentTradingDayEt` is faked so the
// staleness boundary is deterministic regardless of wall-clock date.

let mockRow: Record<string, unknown> | null = null;
let mockMostRecentTradingDay = "2026-07-02";
let mockMarketOpen = false;
let mockDbError: Error | null = null;

// Re-reads the mutable fixtures above at call time (route.ts is imported once in
// before(), and ESM caches a module on first import, so re-registering the mock per
// test would not affect the already-bound import — same pattern as
// src/app/api/platform/intel/route.test.ts's mockBriefDate).
mock.module("../../../../lib/db", {
  namedExports: {
    dbQuery: async () => {
      if (mockDbError) throw mockDbError;
      return mockRow ? { rows: [mockRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    },
  },
});
mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    isCronAuthorized: () => false,
  },
});
mock.module("../../../../features/nighthawk/lib/session", {
  namedExports: {
    formatEtDate,
    mostRecentTradingDayEt: () => mockMostRecentTradingDay,
  },
});
mock.module("../../../../lib/et-market-hours", {
  namedExports: {
    isEtCashRth: () => mockMarketOpen,
  },
});

const baseRow = (overrides: Record<string, unknown> = {}) => ({
  composite: "BREAKOUT_BULL",
  gex_regime: "STRONG_POSITIVE",
  vol_regime: "NORMAL_VOL",
  trend_regime: "UPTREND",
  flow_regime: "BULL_FLOW",
  playbook: "Buy dips, sell rips.",
  captured_at: new Date("2026-07-02T14:00:00Z"),
  net_gex: "7730543991.593",
  iv_percentile: "63.499999999999",
  above_vwap: true,
  ...overrides,
});

describe("/api/market/regime GET staleness + netGex/ivPercentile rounding", () => {
  let GET: () => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("no rows -> available:false (unchanged pre-existing behavior)", async () => {
    mockRow = null;
    const res = await GET();
    const body = await res.json();
    assert.equal(body.available, false);
    assert.equal("stale" in body, false);
  });

  test("a fresh row (same ET date AND within the refresh window) is not stale", async (t) => {
    // `now` is frozen 148s after the row's capture — the exact live-audit condition (the row was
    // 148s behind and was served stale:false). Same ET date, well inside the 10-min age budget.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-02T14:02:28Z") });
    mockMostRecentTradingDay = "2026-07-02";
    mockMarketOpen = true;
    mockRow = baseRow({ captured_at: new Date("2026-07-02T14:00:00Z") });
    const res = await GET();
    const body = await res.json();
    assert.equal(body.available, true);
    assert.equal(body.stale, false, "148s-old same-day row is genuinely fresh — not stale");
    assert.equal(body.marketOpen, true);
  });

  test("a same-day row OLDER than the refresh window (intraday cron outage) is stale by AGE", async (t) => {
    // The class the date check alone missed: writer stalls mid-session, so the newest row is 45min
    // old but still TODAY's ET date. Date check → not stale; age check → stale. This is the fix.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-02T14:45:00Z") });
    mockMostRecentTradingDay = "2026-07-02";
    mockMarketOpen = true;
    mockRow = baseRow({ captured_at: new Date("2026-07-02T14:00:00Z") });
    const res = await GET();
    const body = await res.json();
    assert.equal(body.stale, true, "45-min-old same-day row exceeds the age budget → stale");
    assert.equal(body.playbook, "Buy dips, sell rips.", "stale text still served — stale is the honesty signal");
  });

  test("an old row (captured_at multiple sessions before mostRecentTradingDayEt) is stale", async (t) => {
    // Mirrors the live bug: mostRecentTradingDayEt says "2026-07-02" (today, e.g. as
    // computed from a Sunday walking back over the July-4th-observed holiday weekend)
    // but the last row on file is from 2026-06-29 — several days/sessions old. Stale by
    // BOTH the age budget and the cross-day date check.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-02T14:00:00Z") });
    mockMostRecentTradingDay = "2026-07-02";
    mockMarketOpen = false;
    mockRow = baseRow({ captured_at: new Date("2026-06-29T14:00:00Z") });
    const res = await GET();
    const body = await res.json();
    assert.equal(body.available, true, "available stays true — additive stale/marketOpen fields only, no known consumer needs available:false");
    assert.equal(body.stale, true);
    assert.equal(body.marketOpen, false);
    // Playbook/regime text is still served for a stale row (per the additive design) —
    // this is what makes `stale` load-bearing: without it, this old text reads as live.
    assert.equal(body.playbook, "Buy dips, sell rips.");
  });

  test("a missing/unparseable captured_at fails CLOSED (stale:true), never silently fresh", async () => {
    mockMostRecentTradingDay = "2026-07-02";
    mockRow = baseRow({ captured_at: null });
    const res = await GET();
    const body = await res.json();
    assert.equal(body.stale, true);
  });

  test("netGex comes back as a real rounded number, not a raw NUMERIC string", async () => {
    mockRow = baseRow({ net_gex: "7730543991.593" });
    const res = await GET();
    const body = await res.json();
    assert.equal(typeof body.netGex, "number");
    assert.equal(body.netGex, 7730543991.59);
  });

  test("ivPercentile (same NUMERIC-string root cause) is also coerced + rounded", async () => {
    mockRow = baseRow({ iv_percentile: "63.499999999999" });
    const res = await GET();
    const body = await res.json();
    assert.equal(typeof body.ivPercentile, "number");
    assert.equal(body.ivPercentile, 63.5);
  });

  test("a null net_gex/iv_percentile stays null, never coerced to 0", async () => {
    mockRow = baseRow({ net_gex: null, iv_percentile: null });
    const res = await GET();
    const body = await res.json();
    assert.equal(body.netGex, null);
    assert.equal(body.ivPercentile, null);
  });

  test("a DB error still returns available:false (unchanged pre-existing behavior)", async () => {
    mockDbError = new Error("connection reset");
    try {
      const res = await GET();
      const body = await res.json();
      assert.equal(body.available, false);
    } finally {
      mockDbError = null;
    }
  });
});
