import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ZeroDteSetupLogRow } from "@/lib/db";
import type { ZeroDteRejectionRow } from "@/lib/zerodte/rejections";
import type { CronHealthPayload } from "@/lib/admin-cron-health";

// mock.module() must be registered before admin-zerodte-health.ts (and therefore its
// dependency imports: db, zerodte/rejections, admin-cron-health, nighthawk/session) is
// ever loaded — same ordering requirement admin-spx-health.test.ts's own header
// comment documents (ES module imports are hoisted ahead of any other module-body
// code, including a mock.module() call written textually above them). So the module
// under test is loaded dynamically inside before(), same pattern as that file.
//
// Only the exact named exports admin-zerodte-health.ts actually imports from each
// module are mocked, using RELATIVE paths from this file's own location (this repo's
// documented Node 20 mock.module()-alias-crash gotcha).

function setupRow(overrides: Partial<ZeroDteSetupLogRow> = {}): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-05",
    ticker: "AAPL",
    direction: "long",
    top_strike: 220,
    expiry: "2026-07-05",
    score: 80,
    score_max: 85,
    dossier_score: 78,
    conviction: "high",
    gross_premium: 1_200_000,
    spike: false,
    underlying_at_flag: 219.5,
    underlying_latest: 220.1,
    flags_json: null,
    first_flagged_at: "2026-07-05T14:00:00.000Z",
    last_seen_at: "2026-07-05T14:10:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: null,
    entry_premium: 3.2,
    flow_avg_fill: 3.1,
    plan_json: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    status: "OPEN",
    last_mark: 3.4,
    peak_premium: 3.4,
    trough_premium: 3.1,
    ...overrides,
  };
}

function rejectionRow(overrides: Partial<ZeroDteRejectionRow> = {}): ZeroDteRejectionRow {
  return {
    id: 1,
    observed_at: "2026-07-05T14:05:00.000Z",
    session_date: "2026-07-05",
    ticker: "TSLA",
    gate_failed: "min_gross",
    threshold: 750_000,
    gross_premium: 400_000,
    aggression: null,
    side_dominance: null,
    otm_pct: null,
    direction: null,
    prints: 3,
    first_seen: "2026-07-05T13:55:00.000Z",
    last_seen: "2026-07-05T14:05:00.000Z",
    ...overrides,
  };
}

function cronHealthStub(overrides: Partial<CronHealthPayload["jobs"][number]> = {}): CronHealthPayload {
  const gridWarmJob: CronHealthPayload["jobs"][number] = {
    key: "zerodte-warm",
    name: "0DTE Command Warm",
    kind: "http",
    path: "/api/cron/zerodte-warm",
    schedule_label: "~Every 2 min (market hours)",
    description: "test",
    status: "healthy",
    status_label: "OK",
    market_hours_stale: false,
    last_run_at: "2026-07-05T14:08:00.000Z",
    last_status: "ok",
    last_duration_ms: 1200,
    last_message: "ok",
    age_min: 2,
    stale_after_min: 15,
    effective_stale_min: 15,
    stale_multiplier: 1,
    runs_24h: { ok: 10, failed: 0, skipped: 0 },
    ...overrides,
  };
  return {
    generated_at: "2026-07-05T14:10:00.000Z",
    cron_secret_configured: true,
    db_configured: true,
    logged_runs_total: 100,
    diagnostics_note: null,
    summary: { total: 1, healthy: 1, warning: 0, stale: 0, failed: 0, unknown: 0, market_hours_stale: 0 },
    jobs: [gridWarmJob],
    recent_events: [],
  };
}

let dbConfiguredImpl: () => boolean = () => true;
let setupLogImpl: () => Promise<ZeroDteSetupLogRow[]> = async () => [];
let rejectionsImpl: () => Promise<ZeroDteRejectionRow[]> = async () => [];
let cronHealthImpl: () => Promise<CronHealthPayload> = async () => cronHealthStub();
let todayImpl: () => string = () => "2026-07-05";

mock.module("./db", {
  namedExports: {
    dbConfigured: () => dbConfiguredImpl(),
    fetchZeroDteSetupLog: async (_sessionDate: string) => setupLogImpl(),
  },
});
mock.module("./zerodte/rejections", {
  namedExports: {
    fetchZeroDteRejections: async (_opts?: { ticker?: string; limit?: number }) => rejectionsImpl(),
  },
});
mock.module("./admin-cron-health", {
  namedExports: {
    buildCronHealthSnapshot: async () => cronHealthImpl(),
  },
});
mock.module("../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => todayImpl(),
  },
});

let fetchZeroDteHealthSnapshot: typeof import("./admin-zerodte-health").fetchZeroDteHealthSnapshot;

before(async () => {
  ({ fetchZeroDteHealthSnapshot } = await import("./admin-zerodte-health"));
});

function resetMocks() {
  dbConfiguredImpl = () => true;
  setupLogImpl = async () => [];
  rejectionsImpl = async () => [];
  cronHealthImpl = async () => cronHealthStub();
  todayImpl = () => "2026-07-05";
}

test("fetchZeroDteHealthSnapshot: happy path — distinct committed + rejected tickers combine into candidates_scanned/rejection_rate", async () => {
  resetMocks();
  setupLogImpl = async () => [setupRow({ ticker: "AAPL" }), setupRow({ ticker: "MSFT" })];
  rejectionsImpl = async () => [rejectionRow({ ticker: "TSLA" })];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.committed_count, 2);
  assert.equal(snap.rejected_count, 1);
  assert.equal(snap.candidates_scanned, 3);
  assert.equal(snap.rejection_rate, 1 / 3);
  assert.equal(snap.db_configured, true);
  assert.equal(snap.session_date, "2026-07-05");
  assert.deepEqual(snap.errors, []);
});

test("fetchZeroDteHealthSnapshot: scan summary is sourced verbatim from buildCronHealthSnapshot's zerodte-warm job entry", async () => {
  resetMocks();
  cronHealthImpl = async () =>
    cronHealthStub({
      status: "stale",
      status_label: "No run in 40m (limit 15m)",
      last_run_at: "2026-07-05T13:00:00.000Z",
      age_min: 40,
    });

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.scan.status, "stale");
  assert.equal(snap.scan.status_label, "No run in 40m (limit 15m)");
  assert.equal(snap.scan.last_scan_at, "2026-07-05T13:00:00.000Z");
  assert.equal(snap.scan.age_min, 40);
  assert.equal(snap.scan.stale_after_min, 15);
});

test("fetchZeroDteHealthSnapshot: a ticker rejected earlier today but committed later counts ONCE, as committed, not as a rejection", async () => {
  resetMocks();
  setupLogImpl = async () => [setupRow({ ticker: "NVDA" })];
  rejectionsImpl = async () => [rejectionRow({ ticker: "NVDA", gate_failed: "min_dominance" })];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.committed_count, 1);
  assert.equal(snap.rejected_count, 0);
  assert.equal(snap.candidates_scanned, 1);
  assert.equal(snap.rejection_rate, 0);
});

test("fetchZeroDteHealthSnapshot: rejections from a PRIOR session_date are excluded from today's counts", async () => {
  resetMocks();
  rejectionsImpl = async () => [
    rejectionRow({ ticker: "TSLA", session_date: "2026-07-05" }),
    rejectionRow({ ticker: "AMD", session_date: "2026-07-04" }),
  ];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.rejected_count, 1);
  assert.equal(snap.candidates_scanned, 1);
});

test("fetchZeroDteHealthSnapshot: zero candidates today reports rejection_rate null, never a fabricated 0", async () => {
  resetMocks();

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.candidates_scanned, 0);
  assert.equal(snap.rejection_rate, null);
});

test("fetchZeroDteHealthSnapshot: cron-health failure degrades scan to defaults but never throws", async () => {
  resetMocks();
  cronHealthImpl = async () => {
    throw new Error("cron health boom");
  };
  setupLogImpl = async () => [setupRow({ ticker: "AAPL" })];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.scan.status, "unknown");
  assert.equal(snap.scan.last_scan_at, null);
  assert.equal(snap.committed_count, 1);
  assert.ok(snap.errors.some((e) => e.includes("cron health") && e.includes("cron health boom")));
});

test("fetchZeroDteHealthSnapshot: setup-log failure still surfaces real rejections (partial degrade, not both blanked)", async () => {
  resetMocks();
  setupLogImpl = async () => {
    throw new Error("db down");
  };
  rejectionsImpl = async () => [rejectionRow({ ticker: "TSLA" })];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.committed_count, 0);
  assert.equal(snap.rejected_count, 1);
  assert.ok(snap.errors.some((e) => e.includes("setup log") && e.includes("db down")));
});

test("fetchZeroDteHealthSnapshot: rejections-log failure still surfaces real committed count (partial degrade, not both blanked)", async () => {
  resetMocks();
  setupLogImpl = async () => [setupRow({ ticker: "AAPL" })];
  rejectionsImpl = async () => {
    throw new Error("redis-adjacent boom");
  };

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.committed_count, 1);
  assert.equal(snap.rejected_count, 0);
  assert.ok(snap.errors.some((e) => e.includes("rejections") && e.includes("redis-adjacent boom")));
});

test("fetchZeroDteHealthSnapshot: rejections_sample_capped is true only when the full page came back AND its oldest row is still today", async () => {
  resetMocks();
  // 500 rows (the module's REJECTIONS_SAMPLE_LIMIT), all today, DESC by observed_at
  // (most recent first) — the last element is the oldest included row.
  rejectionsImpl = async () =>
    Array.from({ length: 500 }, (_, i) =>
      rejectionRow({ id: i + 1, ticker: `T${i}`, session_date: "2026-07-05" })
    );

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.rejections_sample_capped, true);
});

test("fetchZeroDteHealthSnapshot: rejections_sample_capped is false when the page's oldest row already rolled off today", async () => {
  resetMocks();
  rejectionsImpl = async () =>
    Array.from({ length: 500 }, (_, i) =>
      rejectionRow({
        id: i + 1,
        ticker: `T${i}`,
        // Last element (oldest in the page) is from a prior day — proves every
        // one of today's rows was necessarily captured in this page.
        session_date: i === 499 ? "2026-07-04" : "2026-07-05",
      })
    );

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.rejections_sample_capped, false);
});

test("fetchZeroDteHealthSnapshot: rejections_sample_capped is false when the page came back under the limit", async () => {
  resetMocks();
  rejectionsImpl = async () => [rejectionRow({ ticker: "TSLA" })];

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.rejections_sample_capped, false);
});

test("fetchZeroDteHealthSnapshot: db_configured mirrors dbConfigured() verbatim", async () => {
  resetMocks();
  dbConfiguredImpl = () => false;

  const snap = await fetchZeroDteHealthSnapshot();

  assert.equal(snap.db_configured, false);
});
