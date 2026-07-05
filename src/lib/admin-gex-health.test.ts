import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmapCachePeek } from "@/lib/providers/polygon-options-gex";
import type { GexRegimeEventRow } from "@/lib/providers/gex-regime-events";
import type { CronJobHealth } from "@/lib/admin-cron-health";
import type { ErrorEventRow } from "@/lib/error-sink";

// mock.module() must be registered before admin-gex-health.ts (and therefore its dependency
// imports: heatmap-allowlist, providers/polygon-options-gex, providers/gex-regime-events,
// admin-cron-health, error-sink, db) is ever loaded — same ordering requirement (and the same
// Node 20 "always the RELATIVE path, never the @/ alias" gotcha) as admin-spx-health.test.ts's
// own header comment documents. The module under test is loaded dynamically inside before().

function tickerPeek(ticker: string, overrides: Partial<GexHeatmapCachePeek> = {}): GexHeatmapCachePeek {
  return {
    ticker,
    cached: true,
    last_compute_at: "2026-07-05T14:00:00.000Z",
    age_sec: 5,
    ttl_sec: 20,
    stale: false,
    spot: 5555,
    events_count: 0,
    ...overrides,
  };
}

function regimeRow(overrides: Partial<GexRegimeEventRow> = {}): GexRegimeEventRow {
  return {
    id: 1,
    observed_at: new Date().toISOString(),
    session_date: "2026-07-05",
    ticker: "SPY",
    event_type: "flip_crossed",
    severity: "warn",
    message: "test event",
    level: 550,
    direction: "into short gamma",
    from_value: 551,
    to_value: 549,
    detected_at: new Date().toISOString(),
    ...overrides,
  };
}

function cronJob(overrides: Partial<CronJobHealth> = {}): CronJobHealth {
  return {
    key: "heatmap-warm",
    name: "Thermal Warm",
    kind: "http",
    path: "/api/cron/heatmap-warm",
    schedule_label: "~Every 30s (market hours)",
    description: "test",
    status: "healthy",
    status_label: "OK",
    market_hours_stale: false,
    last_run_at: "2026-07-05T14:00:00.000Z",
    last_status: "ok",
    last_duration_ms: 100,
    last_message: null,
    age_min: 1,
    stale_after_min: 10,
    effective_stale_min: 10,
    stale_multiplier: 1,
    runs_24h: { ok: 10, failed: 0, skipped: 0 },
    ...overrides,
  };
}

function errorRow(overrides: Partial<ErrorEventRow> = {}): ErrorEventRow {
  return {
    id: 1,
    source: "manual",
    scope: "polygon-gex",
    name: "Error",
    message: "chain fetch failed",
    stack: null,
    meta_json: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const PRESET_TICKERS = ["SPY", "SPX", "QQQ"];

let peekImpl: (ticker: string) => Promise<GexHeatmapCachePeek> = async (ticker) => tickerPeek(ticker);
let regimeEventsImpl: () => Promise<GexRegimeEventRow[]> = async () => [regimeRow()];
let cronSnapshotImpl: () => Promise<{ jobs: CronJobHealth[] }> = async () => ({
  jobs: [cronJob(), cronJob({ key: "gex-alerts", name: "GEX Regime Alerts" }), cronJob({ key: "grid-warm", name: "BlackOut Grid Warm" })],
});
let recentErrorsImpl: () => Promise<ErrorEventRow[]> = async () => [errorRow()];
let dbConfiguredImpl: () => boolean = () => true;
let peekCalls: string[] = [];

mock.module("./heatmap-allowlist", {
  namedExports: {
    heatmapPresetTickers: () => [...PRESET_TICKERS],
  },
});
mock.module("./providers/polygon-options-gex", {
  namedExports: {
    peekGexHeatmapCache: async (ticker: string) => {
      peekCalls.push(ticker);
      return peekImpl(ticker);
    },
  },
});
mock.module("./providers/gex-regime-events", {
  namedExports: {
    fetchGexRegimeEvents: async () => regimeEventsImpl(),
  },
});
mock.module("./admin-cron-health", {
  namedExports: {
    buildCronHealthSnapshot: async () => cronSnapshotImpl(),
  },
});
mock.module("./error-sink", {
  namedExports: {
    fetchRecentErrorEvents: async () => recentErrorsImpl(),
  },
});
mock.module("./db", {
  namedExports: {
    dbConfigured: () => dbConfiguredImpl(),
  },
});

let fetchGexHealthSnapshot: typeof import("./admin-gex-health").fetchGexHealthSnapshot;
let summarizeRegimeEvents: typeof import("./admin-gex-health").summarizeRegimeEvents;

before(async () => {
  ({ fetchGexHealthSnapshot, summarizeRegimeEvents } = await import("./admin-gex-health"));
});

function resetMocks() {
  peekImpl = async (ticker) => tickerPeek(ticker);
  regimeEventsImpl = async () => [regimeRow()];
  cronSnapshotImpl = async () => ({
    jobs: [cronJob(), cronJob({ key: "gex-alerts", name: "GEX Regime Alerts" }), cronJob({ key: "grid-warm", name: "BlackOut Grid Warm" })],
  });
  recentErrorsImpl = async () => [errorRow()];
  dbConfiguredImpl = () => true;
  peekCalls = [];
}

test("fetchGexHealthSnapshot: happy path wires all four legs through, no errors", async () => {
  resetMocks();

  const snap = await fetchGexHealthSnapshot();

  assert.equal(snap.db_configured, true);
  assert.deepEqual(peekCalls, PRESET_TICKERS);
  assert.equal(snap.tickers.length, PRESET_TICKERS.length);
  assert.equal(snap.tickers[0].ticker, "SPY");
  assert.equal(snap.tickers[0].cached, true);
  assert.equal(snap.regime_events.recent.length, 1);
  assert.equal(snap.regime_events.summary.total, 1);
  // Only the two Thermal-owned jobs pass the filter — grid-warm (BlackOut Grid, a
  // different product) must NOT leak into this panel even though the mocked cron
  // snapshot returns it alongside heatmap-warm/gex-alerts.
  assert.deepEqual(
    snap.cron.map((j) => j.key).sort(),
    ["gex-alerts", "heatmap-warm"]
  );
  assert.equal(snap.recent_errors.length, 1);
  assert.deepEqual(snap.errors, []);
});

test("fetchGexHealthSnapshot: one ticker's peek throwing degrades only that row, never the others", async () => {
  resetMocks();
  peekImpl = async (ticker) => {
    if (ticker === "SPX") throw new Error("redis boom");
    return tickerPeek(ticker);
  };

  const snap = await fetchGexHealthSnapshot();

  assert.equal(snap.tickers.length, PRESET_TICKERS.length);
  const spy = snap.tickers.find((t) => t.ticker === "SPY");
  const spx = snap.tickers.find((t) => t.ticker === "SPX");
  assert.equal(spy?.cached, true);
  assert.equal(spx?.cached, false);
  assert.equal(spx?.stale, true);
  assert.ok(snap.errors.some((e) => e.includes("ticker SPX") && e.includes("redis boom")));
});

test("fetchGexHealthSnapshot: regime-events fetch failure returns empty summary/recent, not a thrown exception", async () => {
  resetMocks();
  regimeEventsImpl = async () => {
    throw new Error("db down");
  };

  const snap = await fetchGexHealthSnapshot();

  assert.deepEqual(snap.regime_events.recent, []);
  assert.equal(snap.regime_events.summary.total, 0);
  assert.ok(snap.errors.some((e) => e.includes("regime events") && e.includes("db down")));
});

test("fetchGexHealthSnapshot: cron-health fetch failure returns an empty cron list, not a thrown exception", async () => {
  resetMocks();
  cronSnapshotImpl = async () => {
    throw new Error("cron snapshot boom");
  };

  const snap = await fetchGexHealthSnapshot();

  assert.deepEqual(snap.cron, []);
  assert.ok(snap.errors.some((e) => e.includes("cron health") && e.includes("cron snapshot boom")));
});

test("fetchGexHealthSnapshot: recent-errors fetch failure returns an empty list, not a thrown exception", async () => {
  resetMocks();
  recentErrorsImpl = async () => {
    throw new Error("error_events unreachable");
  };

  const snap = await fetchGexHealthSnapshot();

  assert.deepEqual(snap.recent_errors, []);
  assert.ok(snap.errors.some((e) => e.includes("recent errors") && e.includes("error_events unreachable")));
});

test("fetchGexHealthSnapshot: recent-errors leg filters to GEX-scoped rows only (best-effort substring match)", async () => {
  resetMocks();
  recentErrorsImpl = async () => [
    errorRow({ id: 1, scope: "polygon-gex", message: "chain fetch failed" }),
    errorRow({ id: 2, scope: "spx-desk", message: "unrelated desk failure" }),
    errorRow({ id: 3, scope: null, name: "Error", message: "heatmap build threw" }),
  ];

  const snap = await fetchGexHealthSnapshot();

  assert.equal(snap.recent_errors.length, 2);
  assert.deepEqual(
    snap.recent_errors.map((e) => e.message),
    ["chain fetch failed", "heatmap build threw"]
  );
});

test("fetchGexHealthSnapshot: db_configured reflects dbConfigured(), independent of the DB-backed regime-events leg", async () => {
  resetMocks();
  dbConfiguredImpl = () => false;
  regimeEventsImpl = async () => []; // fetchGexRegimeEvents itself already no-ops when DB is off

  const snap = await fetchGexHealthSnapshot();

  assert.equal(snap.db_configured, false);
  assert.deepEqual(snap.regime_events.recent, []);
  assert.deepEqual(snap.errors, []);
});

test("summarizeRegimeEvents: buckets by ticker and type within the window, excludes rows outside it", async () => {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const rows: GexRegimeEventRow[] = [
    regimeRow({ id: 1, ticker: "SPY", event_type: "flip_crossed", observed_at: iso(60_000) }),
    regimeRow({ id: 2, ticker: "SPY", event_type: "wall_broken", observed_at: iso(120_000) }),
    regimeRow({ id: 3, ticker: "QQQ", event_type: "flip_crossed", observed_at: iso(180_000) }),
    // Outside the 1-hour window used below — must be excluded from both totals.
    regimeRow({ id: 4, ticker: "SPY", event_type: "flip_crossed", observed_at: iso(2 * 60 * 60_000) }),
  ];

  const summary = summarizeRegimeEvents(rows, 60 * 60_000);

  assert.equal(summary.window_hours, 1);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.by_ticker, [
    { ticker: "SPY", count: 2 },
    { ticker: "QQQ", count: 1 },
  ]);
  const flipCrossed = summary.by_type.find((t) => t.type === "flip_crossed");
  const wallBroken = summary.by_type.find((t) => t.type === "wall_broken");
  assert.equal(flipCrossed?.count, 2);
  assert.equal(wallBroken?.count, 1);
});

test("summarizeRegimeEvents: empty input yields a zeroed summary, never throws", async () => {
  const summary = summarizeRegimeEvents([], 24 * 60 * 60_000);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.by_ticker, []);
  assert.deepEqual(summary.by_type, []);
  assert.equal(summary.window_hours, 24);
});
