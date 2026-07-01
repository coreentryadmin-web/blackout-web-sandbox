import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { isPremarketBriefFresh } from "../../../../lib/providers/spx-session";

// Regression: /api/platform/intel fed a "last brief" of unknown age straight to
// crons and AI prompt context via lastBrief — /api/brief/premarket gates this
// with isPremarketBriefFresh() (see spx-session.ts), but this sibling endpoint
// (same platform_briefs table, same "last one wins" query) never did, so a
// brief 2+ sessions stale kept getting served here even after that fix.
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

mock.module("../../../../lib/db", {
  namedExports: {
    dbQuery: async (sql: string) =>
      /platform_briefs/.test(sql) && mockBriefDate
        ? { rows: [briefRow(mockBriefDate)], rowCount: 1 }
        : emptyRows,
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
