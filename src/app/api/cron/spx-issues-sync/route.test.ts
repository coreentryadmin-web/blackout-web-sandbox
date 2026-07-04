import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression coverage for the "sync only ran when a human loaded the admin dashboard"
// gap (docs/audit/FINDINGS.md): this cron must independently compute SPX play/engine
// issues and call syncAdminIncidents with them. mock.module() resolves bare specifiers
// relative to THIS file (not the "@/" tsconfig alias) — see
// src/app/api/market/quote/route.test.ts for the same pattern. Mocking the granular
// deps of src/lib/spx-issues-sync.ts (rather than mocking that module wholesale) lets
// this test exercise the REAL runSpxIssuesSync() body while stubbing out the
// provider/DB reach underneath it.

let cronAuthorized = true;
let cronWindowOpen = true;
let syncShouldThrow = false;
type SyncCall = { issues: Array<{ category: string; title: string }>; resolveScope?: (c: string) => boolean };
let syncCalls: SyncCall[] = [];
let loggedRuns: Array<{ jobKey: string; payload: Record<string, unknown> }> = [];

const mockIssues = [
  { id: "play:0:Claude veto active", severity: "info" as const, category: "play", title: "Claude veto active", detail: "thesis" },
  { id: "engine:1:Play engine tick aging", severity: "warning" as const, category: "engine", title: "Play engine tick aging", detail: "last tick 90s ago" },
];

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    isCronAuthorized: () => cronAuthorized,
  },
});
mock.module("../../../../lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
  },
});
mock.module("../../../../lib/spx-play-session-guards", {
  namedExports: {
    isSpxEngineCronWindow: () => cronWindowOpen,
  },
});
mock.module("../../../../lib/cron-run", {
  namedExports: {
    logCronRun: async (jobKey: string, _started: number, payload: Record<string, unknown>) => {
      loggedRuns.push({ jobKey, payload });
    },
  },
});
// Deep dependencies of runSpxIssuesSync (src/lib/spx-issues-sync.ts):
mock.module("../../../../lib/spx-desk-loader", {
  namedExports: {
    loadMergedSpxDesk: async () => ({
      merged: { price: 6300, market_open: true, vwap: null, pdh: null, pdl: null, hod: null, lod: null },
    }),
  },
});
mock.module("../../../../lib/spx-play-technicals", {
  namedExports: {
    buildPlayTechnicals: async () => ({}),
  },
});
mock.module("../../../../lib/spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async () => ({ claude: null, gates: { passed: true, blocks: [], warnings: [] } }),
  },
});
mock.module("../../../../lib/admin-spx-issues", {
  namedExports: {
    buildSpxAdminIssues: async () => ({
      generated_at: new Date().toISOString(),
      counts: { critical: 0, warning: 1, info: 1, total: 2 },
      health_ok: false,
      issues: mockIssues,
      api_errors: [],
    }),
  },
});
mock.module("../../../../lib/admin-incidents", {
  namedExports: {
    syncAdminIncidents: async (
      issues: SyncCall["issues"],
      options?: { resolveScope?: (c: string) => boolean }
    ) => {
      if (syncShouldThrow) throw new Error("db unavailable");
      syncCalls.push({ issues, resolveScope: options?.resolveScope });
    },
  },
});

describe("GET /api/cron/spx-issues-sync", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("rejects unauthorized requests without computing or syncing anything", async () => {
    cronAuthorized = false;
    syncCalls = [];
    const res = await GET(new NextRequest("http://localhost/api/cron/spx-issues-sync"));
    assert.equal(res.status, 401);
    assert.equal(syncCalls.length, 0);
    cronAuthorized = true;
  });

  test("skips outside the SPX engine cron window without a force flag", async () => {
    cronWindowOpen = false;
    syncCalls = [];
    loggedRuns = [];
    const res = await GET(new NextRequest("http://localhost/api/cron/spx-issues-sync"));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    assert.equal(syncCalls.length, 0, "an outside-window skip must never touch admin_incidents");
    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0].jobKey, "spx-issues-sync");
    cronWindowOpen = true;
  });

  test("computes issues via buildSpxAdminIssues and calls syncAdminIncidents with them", async () => {
    syncCalls = [];
    loggedRuns = [];
    const res = await GET(new NextRequest("http://localhost/api/cron/spx-issues-sync?force=1"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.issues_synced, 2);
    assert.deepEqual(body.counts, { critical: 0, warning: 1, info: 1, total: 2 });

    assert.equal(syncCalls.length, 1, "the route must call syncAdminIncidents exactly once with the computed issues");
    assert.deepEqual(syncCalls[0].issues, mockIssues);

    // resolveScope must match the admin dashboard's own namespace split (SPX_ISSUES_RESOLVE_SCOPE
    // in spx-issues-sync.ts) — everything EXCEPT data-integrity*, which stays owned by the
    // data-integrity cron's own reconcile.
    assert.equal(syncCalls[0].resolveScope?.("play"), true);
    assert.equal(syncCalls[0].resolveScope?.("engine"), true);
    assert.equal(syncCalls[0].resolveScope?.("data-integrity-freshness"), false);

    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0].jobKey, "spx-issues-sync");
    assert.equal(loggedRuns[0].payload.ok, true);
  });

  test("logs a failed cron run and returns 500 when the sync throws", async () => {
    syncShouldThrow = true;
    syncCalls = [];
    loggedRuns = [];
    const res = await GET(new NextRequest("http://localhost/api/cron/spx-issues-sync?force=1"));
    const body = await res.json();

    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0].payload.ok, false);
    assert.match(String(loggedRuns[0].payload.error), /db unavailable/);
    syncShouldThrow = false;
  });
});
