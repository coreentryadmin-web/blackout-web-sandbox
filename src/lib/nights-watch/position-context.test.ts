import assert from "node:assert/strict";
import { before, beforeEach, describe, test, mock } from "node:test";

// Regression / coverage for the new SPX Slayer cross-reference (enhancement, not a bug fix):
// buildPositionContextMap() now attaches ctx.spxSlayerOpenPlay for SPX/SPXW underlyings by
// reading SPX Slayer's own play-engine state (spx_open_play, via the existing getSpxOpenPlay()
// in spx-service.ts — reused verbatim, no new query). This must be:
//   - populated (the play's direction/grade/entry_price/opened_at) when the engine has a real
//     open play for the session;
//   - explicitly `null` (never undefined) when the engine has checked and has nothing open;
//   - left entirely UNSET (undefined) for non-SPX underlyings in the SAME batch call — SPX
//     Slayer's engine only ever trades SPX/SPXW, so a non-SPX position must never regress.
//
// Every other upstream buildPositionContextMap touches (desk, GEX heatmap, flows, technicals,
// dark pool, earnings) is mocked to a cheap constant/null so this file exercises ONLY the new
// cross-reference wiring, not the pre-existing enrichment paths (already covered by
// verdict.test.ts / enrichment.test.ts). `todayEt` is mocked to a MUTABLE, test-controlled
// value (bumped per test) so each test's cache keys (all of which are date-scoped) are
// guaranteed never to collide with each other or with any real "today" key used elsewhere in
// the process — mirroring the fixed-test-date pattern in spx-desk-loader.test.ts.

type MockOpenPlay = {
  id: number;
  session_date: string;
  direction: "long" | "short";
  entry_price: number;
  entry_score: number;
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  trim_done: boolean;
  mfe_pts: number;
  mae_pts: number;
  opened_at: string;
  status: "open" | "closed";
} | null;

let mockOpenPlay: MockOpenPlay = null;
let mockTodayEt = "2099-01-01";
let openPlayCallCount = 0;

mock.module("../et-date", {
  namedExports: {
    todayEt: () => mockTodayEt,
  },
});

mock.module("../platform/spx-service", {
  namedExports: {
    // The exact function position-context.ts's getNwSpxOpenPlay() reuses — asserting the
    // real fetchOpenSpxPlay DB read is never duplicated: this is the ONLY seam we mock.
    // Registered ONCE at module scope (not per-test) since re-importing an already-cached
    // "./position-context" module instance would keep its ORIGINAL live binding to this
    // mock rather than picking up a later mock.module() call — so every test shares this
    // single mock and asserts via the mutable mockOpenPlay/openPlayCallCount closures.
    getSpxOpenPlay: async () => {
      openPlayCallCount++;
      return { open_play: mockOpenPlay };
    },
  },
});

mock.module("../spx-desk-loader", {
  namedExports: {
    // available:false → spxContext resolves to EMPTY_CONTEXT (source:"none"); this test
    // suite only cares about the spxSlayerOpenPlay field, not desk-derived fields.
    loadMergedSpxDesk: async () => ({
      desk: { available: false },
      flow: null,
      pulse: null,
      merged: { available: false },
    }),
  },
});

mock.module("../providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => null,
  },
});

mock.module("../db", {
  namedExports: {
    fetchRecentFlows: async () => [],
  },
});

mock.module("../providers/polygon-largo", {
  namedExports: {
    fetchPolygonMtfTechnicals: async () => null,
  },
});

mock.module("../providers/polygon", {
  namedExports: {
    fetchBenzingaEarnings: async () => null,
  },
});

mock.module("../providers/unusual-whales", {
  namedExports: {
    fetchUwDarkPool: async () => null,
    fetchUwEarnings: async () => null,
    fetchUwEarningsEstimates: async () => null,
  },
});

describe("position-context: buildPositionContextMap SPX Slayer cross-reference", () => {
  let buildPositionContextMap: typeof import("./position-context").buildPositionContextMap;

  before(async () => {
    ({ buildPositionContextMap } = await import("./position-context"));
  });

  beforeEach(() => {
    mockOpenPlay = null;
    openPlayCallCount = 0;
  });

  test("SPX position picks up spxSlayerOpenPlay when the engine has a real open play", async () => {
    mockTodayEt = "2099-02-01";
    mockOpenPlay = {
      id: 42,
      session_date: "2099-02-01",
      direction: "long",
      entry_price: 6050.25,
      entry_score: 88,
      stop: 6030,
      target: 6090,
      grade: "A",
      headline: "Confluence long",
      trim_done: false,
      mfe_pts: 12,
      mae_pts: 2,
      opened_at: "2099-02-01T14:35:00.000Z",
      status: "open",
    };

    const map = await buildPositionContextMap(["SPX"]);
    const ctx = map.get("SPX");
    assert.ok(ctx, "expected a context entry for SPX");
    assert.deepEqual(ctx!.spxSlayerOpenPlay, {
      direction: "long",
      grade: "A",
      entry_price: 6050.25,
      opened_at: "2099-02-01T14:35:00.000Z",
    });
  });

  test("SPX position gets spxSlayerOpenPlay:null (not undefined) when the engine has no play open", async () => {
    mockTodayEt = "2099-02-02";
    mockOpenPlay = null;

    const map = await buildPositionContextMap(["SPXW"]);
    const ctx = map.get("SPXW");
    assert.ok(ctx, "expected a context entry for SPXW");
    assert.equal(ctx!.spxSlayerOpenPlay, null);
    // Explicitly distinguish null (checked, none open) from the key being absent.
    assert.ok("spxSlayerOpenPlay" in ctx!);
  });

  test("non-SPX tickers in the SAME batch never get spxSlayerOpenPlay set, even when a play is open", async () => {
    mockTodayEt = "2099-02-03";
    mockOpenPlay = {
      id: 43,
      session_date: "2099-02-03",
      direction: "short",
      entry_price: 5990,
      entry_score: 75,
      stop: 6010,
      target: 5950,
      grade: "B",
      headline: "Confluence short",
      trim_done: false,
      mfe_pts: 5,
      mae_pts: 1,
      opened_at: "2099-02-03T15:00:00.000Z",
      status: "open",
    };

    const map = await buildPositionContextMap(["SPX", "AAPL"]);
    const spxCtx = map.get("SPX");
    const aaplCtx = map.get("AAPL");
    assert.ok(spxCtx && aaplCtx, "expected context entries for both tickers");

    // SPX gets the live play...
    assert.deepEqual(spxCtx!.spxSlayerOpenPlay, {
      direction: "short",
      grade: "B",
      entry_price: 5990,
      opened_at: "2099-02-03T15:00:00.000Z",
    });
    // ...AAPL (non-SPX) never has the field populated at all.
    assert.equal(aaplCtx!.spxSlayerOpenPlay, undefined);
    assert.ok(!("spxSlayerOpenPlay" in aaplCtx!));
  });

  test("a batch with ONLY non-SPX tickers never calls getSpxOpenPlay at all", async () => {
    mockTodayEt = "2099-02-04";

    const map = await buildPositionContextMap(["AAPL", "TSLA"]);
    assert.equal(openPlayCallCount, 0, "getSpxOpenPlay must never be called for an all-non-SPX batch");
    assert.equal(map.get("AAPL")!.spxSlayerOpenPlay, undefined);
    assert.equal(map.get("TSLA")!.spxSlayerOpenPlay, undefined);
  });
});
