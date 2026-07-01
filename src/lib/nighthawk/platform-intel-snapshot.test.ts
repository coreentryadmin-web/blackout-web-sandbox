import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { PlatformIntelSnapshot } from "./platform-intel-snapshot";
import { isPremarketBriefFresh } from "../providers/spx-session";

// Regression: fetchPlatformIntelSnapshot() feeds last_brief straight into
// formatPlatformIntelForPrompt() (AI/cron context), from the same
// platform_briefs "last one wins" query as /api/brief/premarket and
// /api/platform/intel — but never gated it on isPremarketBriefFresh(), so a
// brief 2+ sessions stale kept reaching cron/AI decisioning here too.
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

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (sql: string) =>
      /platform_briefs/.test(sql) && mockBriefDate
        ? { rows: [briefRow(mockBriefDate)], rowCount: 1 }
        : emptyRows,
  },
});
mock.module("../providers/spx-session", {
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
