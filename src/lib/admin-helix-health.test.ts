import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { FlowAnomalyRow } from "@/lib/db";
import type { FlowAnomalyNearMissRow } from "@/lib/platform/flow-anomaly-near-misses";
import type { CronJobHealth } from "@/lib/admin-cron-health";
import type { FlowLivenessPeek } from "@/lib/flow-liveness";
import type { ErrorEventRow } from "@/lib/error-sink";

// mock.module() must be registered before admin-helix-health.ts (and therefore its
// dependency imports: db, platform/flow-anomaly-near-misses, admin-cron-health,
// flow-liveness, error-sink, nighthawk/session) is ever loaded — same ordering
// requirement (and the same Node 20 "always the RELATIVE path, never the @/ alias"
// gotcha) admin-gex-health.test.ts / admin-zerodte-health.test.ts's own header
// comments document. The module under test is loaded dynamically inside before().

function committedRow(overrides: Partial<FlowAnomalyRow> = {}): FlowAnomalyRow {
  return {
    id: 1,
    detected_at: "2026-07-05T14:00:00.000Z",
    anomaly_type: "LARGE_PREMIUM_PRINT",
    ticker: "AAPL",
    detail: "AAPL: $3.2M single C print at strike 220",
    premium: 3_200_000,
    direction: "bullish",
    severity: "HIGH",
    ...overrides,
  };
}

function nearMissRow(overrides: Partial<FlowAnomalyNearMissRow> = {}): FlowAnomalyNearMissRow {
  return {
    id: 1,
    observed_at: "2026-07-05T14:05:00.000Z",
    anomaly_type: "LARGE_PREMIUM_PRINT",
    ticker: "TSLA",
    reason: "BELOW_THRESHOLD",
    metric_value: 1_800_000,
    threshold: 2_000_000,
    premium: 1_800_000,
    direction: "bullish",
    severity: null,
    detail: "TSLA: $1.80M single C print — below the $2.0M anomaly threshold",
    ...overrides,
  };
}

function cronHealthStub(
  overrides: Partial<CronJobHealth> = {},
  extra: CronJobHealth[] = []
): { jobs: CronJobHealth[] } {
  const flowIngestJob: CronJobHealth = {
    key: "flow-ingest",
    name: "Flow Ingest",
    kind: "http",
    path: "/api/cron/flow-ingest",
    schedule_label: "~Every 2 min (market hours)",
    description: "test",
    status: "healthy",
    status_label: "OK",
    market_hours_stale: false,
    last_run_at: "2026-07-05T14:08:00.000Z",
    last_status: "ok",
    last_duration_ms: 400,
    last_message: "ok",
    age_min: 2,
    stale_after_min: 15,
    effective_stale_min: 15,
    stale_multiplier: 1,
    runs_24h: { ok: 100, failed: 0, skipped: 0 },
    ...overrides,
  };
  return { jobs: [flowIngestJob, ...extra] };
}

function heartbeatPeek(overrides: Partial<FlowLivenessPeek> = {}): FlowLivenessPeek {
  return {
    heartbeat_present: true,
    last_frame_at: "2026-07-05T14:09:30.000Z",
    age_sec: 15,
    fresh: true,
    ...overrides,
  };
}

function errorRow(overrides: Partial<ErrorEventRow> = {}): ErrorEventRow {
  return {
    id: 1,
    source: "manual",
    scope: "flow-ingest",
    name: "Error",
    message: "UW flow poll failed",
    stack: null,
    meta_json: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

let dbConfiguredImpl: () => boolean = () => true;
let committedImpl: () => Promise<FlowAnomalyRow[]> = async () => [];
let nearMissImpl: () => Promise<FlowAnomalyNearMissRow[]> = async () => [];
let cronHealthImpl: () => Promise<{ jobs: CronJobHealth[] }> = async () => cronHealthStub();
let heartbeatImpl: () => Promise<FlowLivenessPeek> = async () => heartbeatPeek();
let recentErrorsImpl: () => Promise<ErrorEventRow[]> = async () => [];
let todayImpl: () => string = () => "2026-07-05";

mock.module("./db", {
  namedExports: {
    dbConfigured: () => dbConfiguredImpl(),
    fetchFlowAnomalies: async (_opts?: { limit?: number }) => committedImpl(),
  },
});
mock.module("./platform/flow-anomaly-near-misses", {
  namedExports: {
    fetchFlowAnomalyNearMissesFor: async (_opts?: { ticker?: string; limit?: number }) => nearMissImpl(),
  },
});
mock.module("./admin-cron-health", {
  namedExports: {
    buildCronHealthSnapshot: async () => cronHealthImpl(),
  },
});
mock.module("./flow-liveness", {
  namedExports: {
    peekFlowLivenessHeartbeat: async (_maxAgeMs?: number) => heartbeatImpl(),
  },
});
mock.module("./error-sink", {
  namedExports: {
    fetchRecentErrorEvents: async (_limit?: number) => recentErrorsImpl(),
  },
});
mock.module("../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => todayImpl(),
    // Deterministic regardless of wall-clock time: operates only on the Date
    // objects this module constructs from fixture timestamps, never on a
    // real `new Date()` — see admin-helix-health.ts's module doc for why
    // `today` itself comes from the mocked todayEt() above, not this.
    formatEtDate: (d: Date) => d.toISOString().slice(0, 10),
  },
});

let fetchHelixHealthSnapshot: typeof import("./admin-helix-health").fetchHelixHealthSnapshot;

before(async () => {
  ({ fetchHelixHealthSnapshot } = await import("./admin-helix-health"));
});

function resetMocks() {
  dbConfiguredImpl = () => true;
  committedImpl = async () => [];
  nearMissImpl = async () => [];
  cronHealthImpl = async () => cronHealthStub();
  heartbeatImpl = async () => heartbeatPeek();
  recentErrorsImpl = async () => [];
  todayImpl = () => "2026-07-05";
}

test("fetchHelixHealthSnapshot: happy path wires all four legs through, no errors", async () => {
  resetMocks();
  committedImpl = async () => [committedRow({ ticker: "AAPL" })];
  nearMissImpl = async () => [nearMissRow({ ticker: "TSLA" })];
  cronHealthImpl = async () =>
    cronHealthStub({}, [
      { ...cronHealthStub().jobs[0], key: "market-regime-detector", name: "Market Regime Detector" },
      { ...cronHealthStub().jobs[0], key: "grid-warm", name: "BlackOut Grid Warm" },
    ]);

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.db_configured, true);
  assert.equal(snap.session_date, "2026-07-05");
  // Only the two HELIX-owned jobs pass the filter — grid-warm (a different
  // product's cron) must NOT leak into this panel even though the mocked cron
  // snapshot returns it alongside flow-ingest/market-regime-detector.
  assert.deepEqual(
    snap.cron.map((j) => j.key).sort(),
    ["flow-ingest", "market-regime-detector"]
  );
  assert.equal(snap.tape.fresh, true);
  assert.equal(snap.tape.heartbeat_present, true);
  assert.equal(snap.committed_count, 1);
  assert.equal(snap.near_miss_only_count, 1);
  assert.equal(snap.candidates_scanned, 2);
  assert.equal(snap.near_miss_rate, 0.5);
  assert.equal(snap.recent_committed.length, 1);
  assert.equal(snap.recent_near_misses.length, 1);
  assert.deepEqual(snap.errors, []);
});

test("fetchHelixHealthSnapshot: distinct committed + near-miss-only tickers combine into candidates_scanned/near_miss_rate", async () => {
  resetMocks();
  committedImpl = async () => [committedRow({ ticker: "AAPL" }), committedRow({ id: 2, ticker: "MSFT" })];
  nearMissImpl = async () => [nearMissRow({ ticker: "TSLA" })];

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.committed_count, 2);
  assert.equal(snap.near_miss_only_count, 1);
  assert.equal(snap.candidates_scanned, 3);
  assert.equal(snap.near_miss_rate, 1 / 3);
});

test("fetchHelixHealthSnapshot: a ticker that near-missed earlier today but later committed counts ONCE, as committed", async () => {
  resetMocks();
  committedImpl = async () => [committedRow({ ticker: "NVDA" })];
  nearMissImpl = async () => [nearMissRow({ ticker: "NVDA", anomaly_type: "DIRECTIONAL_FLOW_SKEW" })];

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.committed_count, 1);
  assert.equal(snap.near_miss_only_count, 0);
  assert.equal(snap.candidates_scanned, 1);
  assert.equal(snap.near_miss_rate, 0);
});

test("fetchHelixHealthSnapshot: near-misses/commits from a PRIOR ET day are excluded from today's counts", async () => {
  resetMocks();
  committedImpl = async () => [committedRow({ ticker: "AAPL", detected_at: "2026-07-04T18:00:00.000Z" })];
  nearMissImpl = async () => [
    nearMissRow({ ticker: "TSLA", observed_at: "2026-07-05T14:05:00.000Z" }),
    nearMissRow({ id: 2, ticker: "AMD", observed_at: "2026-07-04T14:05:00.000Z" }),
  ];

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.committed_count, 0);
  assert.equal(snap.near_miss_only_count, 1);
  assert.equal(snap.candidates_scanned, 1);
});

test("fetchHelixHealthSnapshot: zero candidates today reports near_miss_rate null, never a fabricated 0", async () => {
  resetMocks();

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.candidates_scanned, 0);
  assert.equal(snap.near_miss_rate, null);
});

test("fetchHelixHealthSnapshot: cron-health failure degrades cron to an empty list, never throws", async () => {
  resetMocks();
  cronHealthImpl = async () => {
    throw new Error("cron snapshot boom");
  };
  committedImpl = async () => [committedRow({ ticker: "AAPL" })];

  const snap = await fetchHelixHealthSnapshot();

  assert.deepEqual(snap.cron, []);
  assert.equal(snap.committed_count, 1);
  assert.ok(snap.errors.some((e) => e.includes("cron health") && e.includes("cron snapshot boom")));
});

test("fetchHelixHealthSnapshot: tape heartbeat failure degrades to cold defaults, never throws", async () => {
  resetMocks();
  heartbeatImpl = async () => {
    throw new Error("redis boom");
  };

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.tape.heartbeat_present, false);
  assert.equal(snap.tape.fresh, false);
  assert.equal(snap.tape.last_frame_at, null);
  assert.ok(snap.errors.some((e) => e.includes("tape heartbeat") && e.includes("redis boom")));
});

test("fetchHelixHealthSnapshot: committed-anomalies failure still surfaces real near-miss count (partial degrade, not both blanked)", async () => {
  resetMocks();
  committedImpl = async () => {
    throw new Error("db down");
  };
  nearMissImpl = async () => [nearMissRow({ ticker: "TSLA" })];

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.committed_count, 0);
  assert.equal(snap.near_miss_only_count, 1);
  assert.ok(snap.errors.some((e) => e.includes("committed anomalies") && e.includes("db down")));
});

test("fetchHelixHealthSnapshot: near-misses failure still surfaces real committed count (partial degrade, not both blanked)", async () => {
  resetMocks();
  committedImpl = async () => [committedRow({ ticker: "AAPL" })];
  nearMissImpl = async () => {
    throw new Error("redis-adjacent boom");
  };

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.committed_count, 1);
  assert.equal(snap.near_miss_only_count, 0);
  assert.ok(snap.errors.some((e) => e.includes("near misses") && e.includes("redis-adjacent boom")));
});

test("fetchHelixHealthSnapshot: recent-errors fetch failure returns an empty list, not a thrown exception", async () => {
  resetMocks();
  recentErrorsImpl = async () => {
    throw new Error("error_events unreachable");
  };

  const snap = await fetchHelixHealthSnapshot();

  assert.deepEqual(snap.recent_errors, []);
  assert.ok(snap.errors.some((e) => e.includes("recent errors") && e.includes("error_events unreachable")));
});

test("fetchHelixHealthSnapshot: recent-errors leg filters to HELIX-scoped rows only (best-effort substring match)", async () => {
  resetMocks();
  recentErrorsImpl = async () => [
    errorRow({ id: 1, scope: "flow-ingest", message: "UW flow poll failed" }),
    errorRow({ id: 2, scope: "spx-desk", message: "unrelated desk failure" }),
    errorRow({ id: 3, scope: null, name: "Error", message: "flow_anomaly near-miss insert failed" }),
  ];

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.recent_errors.length, 2);
  assert.deepEqual(
    snap.recent_errors.map((e) => e.message),
    ["UW flow poll failed", "flow_anomaly near-miss insert failed"]
  );
});

test("fetchHelixHealthSnapshot: db_configured mirrors dbConfigured() verbatim", async () => {
  resetMocks();
  dbConfiguredImpl = () => false;

  const snap = await fetchHelixHealthSnapshot();

  assert.equal(snap.db_configured, false);
});
