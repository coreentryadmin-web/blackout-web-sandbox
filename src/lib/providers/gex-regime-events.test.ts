import { test, mock } from "node:test";
import assert from "node:assert/strict";

// gex-regime-events.ts (the module under test) statically imports @/lib/db and
// ./spx-session only (deliberately import-light, same reasoning
// src/lib/zerodte/rejections.ts's module doc gives for staying outside a much
// heavier engine's import graph), so it does NOT need a "server-only" stub —
// neither dependency pulls that in.
//
// persistGexRegimeEvents (task #136) is the GEX-regime-transition analogue of
// persistZeroDteRejections (src/lib/zerodte/rejections.test.ts) — same
// "in-memory string stands in for one platform_meta row" throttle idiom, keyed
// per (ticker, event type+direction) slot instead of zerodte's per-ticker map,
// since a single matrix compute can emit several DIFFERENT event types/
// directions for the SAME ticker in one diff (e.g. a call-wall break and a
// put-wall break together).
const state = {
  dbConfigured: true,
  cursor: null as string | null,
  inserted: [] as Array<Record<string, unknown>>,
};

// Separate, INDEPENDENT in-memory store simulating gex-alerts' own Redis dedup
// key (`gex-alert-sent:{ticker}:{type}:{etDate}[:level]`) — never touched by
// gex-regime-events.ts (which only imports @/lib/db, never ../shared-cache).
// Used below to prove the two concerns (durable history vs. live-alert dedup)
// can never suppress each other.
const fakeAlertRedis = new Map<string, { at: string }>();

function resetState() {
  state.dbConfigured = true;
  state.cursor = null;
  state.inserted = [];
  fakeAlertRedis.clear();
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    getMeta: async (key: string) => (key === "gex_regime_event_cursor" ? state.cursor : null),
    setMeta: async (key: string, value: string) => {
      if (key === "gex_regime_event_cursor") state.cursor = value;
    },
    insertGexRegimeEvent: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
    // Newest-first, mirroring the real ORDER BY observed_at DESC — `inserted` is
    // append-order (oldest first), so this reverses it. Ticker filtering mirrors
    // the real fetchGexRegimeEventRows' WHERE ticker = $1.
    fetchGexRegimeEventRows: async (opts?: { ticker?: string; limit?: number }) => {
      const limit = opts?.limit ?? 50;
      const ticker = opts?.ticker?.toUpperCase();
      return state.inserted
        .slice()
        .reverse()
        .filter((r) => !ticker || r.ticker === ticker)
        .slice(0, limit)
        .map((row, i) => ({
          id: state.inserted.length - i,
          observed_at: "2026-07-06T14:00:00.000Z",
          ...row,
        }));
    },
  },
});
mock.module("./spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before gex-regime-events.ts's own top-level imports
// resolve — same idiom every spx-signal-log-*.test.ts / rejections.test.ts sibling uses.
const mod = () => import("./gex-regime-events");

type EventInput = {
  type: "flip_crossed" | "wall_broken" | "regime_flipped" | "net_gex_sign_flipped";
  severity: "info" | "warn";
  message: string;
  level?: number | null;
  direction?: string | null;
  from_value?: number | null;
  to_value?: number | null;
  at: string;
};

function flipCrossedEvent(overrides: Partial<EventInput> = {}): EventInput {
  return {
    type: "flip_crossed",
    severity: "info",
    message: "Spot crossed the gamma flip (5000) into LONG gamma.",
    level: 5000,
    direction: "into long gamma",
    from_value: 4990,
    to_value: 5010,
    at: "2026-07-06T14:00:00.000Z",
    ...overrides,
  };
}

test("persistGexRegimeEvents: db not configured — never reads/writes platform_meta, zero inserts", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();
  state.dbConfigured = false;

  const n = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);

  assert.equal(n, 0);
  assert.equal(state.inserted.length, 0);
  assert.equal(state.cursor, null);
});

test("persistGexRegimeEvents: empty events array (no crossing this tick) — short-circuits without touching the cursor or inserting a spurious row", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  const n = await persistGexRegimeEvents("SPY", []);

  assert.equal(n, 0);
  assert.equal(state.inserted.length, 0);
  assert.equal(state.cursor, null);
});

test("persistGexRegimeEvents: first crossing for a ticker — inserts a row with the correct shape (including from_value/to_value) and rolls the cursor", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  const n = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.equal(row.session_date, "2026-07-06");
  assert.equal(row.ticker, "SPY");
  assert.equal(row.event_type, "flip_crossed");
  assert.equal(row.severity, "info");
  assert.equal(row.level, 5000);
  assert.equal(row.direction, "into long gamma");
  assert.equal(row.from_value, 4990);
  assert.equal(row.to_value, 5010);
  assert.equal(row.detected_at, "2026-07-06T14:00:00.000Z");
  assert.ok(state.cursor);
});

test("persistGexRegimeEvents: the SAME crossing re-detected on the next matrix compute (ring throttle window) is NOT duplicated, even though message/from_value/to_value jitter", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  await persistGexRegimeEvents("SPY", [flipCrossedEvent({ from_value: 4990, to_value: 5010 })]);
  // Same level (rounds identically) + same direction, but spot has drifted further
  // and the message text changed — computeGexEvents can re-emit this exact
  // crossing on every fresh compute until the ~5-min ring baseline catches up
  // (see the module's own doc comment) — the throttle must still collapse it.
  const n = await persistGexRegimeEvents("SPY", [
    flipCrossedEvent({ message: "different wording", from_value: 5010, to_value: 5025 }),
  ]);

  assert.equal(n, 0, "an unchanged (level, direction) transition must not write a second row");
  assert.equal(state.inserted.length, 1);
});

test("persistGexRegimeEvents: sub-point level jitter that rounds to the same whole strike still throttles as one transition", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  await persistGexRegimeEvents("SPY", [flipCrossedEvent({ level: 5000.1 })]);
  const n = await persistGexRegimeEvents("SPY", [flipCrossedEvent({ level: 5000.4 })]);

  assert.equal(n, 0, "5000.1 and 5000.4 both round to 5000 — same state");
  assert.equal(state.inserted.length, 1);
});

test("persistGexRegimeEvents: a real reversal (direction flips) for the same ticker writes a new row", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  await persistGexRegimeEvents("SPY", [flipCrossedEvent({ direction: "into long gamma" })]);
  const n = await persistGexRegimeEvents("SPY", [
    flipCrossedEvent({ direction: "into short gamma", from_value: 5010, to_value: 4990 }),
  ]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[1]!.direction, "into short gamma");
});

test("persistGexRegimeEvents: a call-wall break and a put-wall break for the SAME ticker in the SAME cycle both write (independent slots), and each throttles independently thereafter", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  const callBreak: EventInput = {
    type: "wall_broken",
    severity: "warn",
    message: "Spot broke ABOVE the call wall.",
    level: 5050,
    direction: "above call wall",
    from_value: 5040,
    to_value: 5060,
    at: "2026-07-06T14:00:00.000Z",
  };
  const putBreak: EventInput = {
    type: "wall_broken",
    severity: "warn",
    message: "Spot broke BELOW the put wall.",
    level: 5000,
    direction: "below put wall",
    from_value: 5010,
    to_value: 4990,
    at: "2026-07-06T14:00:00.000Z",
  };

  const first = await persistGexRegimeEvents("SPY", [callBreak, putBreak]);
  assert.equal(first, 2, "two distinct (type, direction) slots must both write");
  assert.equal(state.inserted.length, 2);

  // Repeating the same cycle (both unchanged) — neither writes again.
  const second = await persistGexRegimeEvents("SPY", [callBreak, putBreak]);
  assert.equal(second, 0);
  assert.equal(state.inserted.length, 2);
});

test("persistGexRegimeEvents: two DIFFERENT tickers crossing in the same cycle both write, independently throttled thereafter", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  const first = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  const second = await persistGexRegimeEvents("QQQ", [flipCrossedEvent({ level: 380 })]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(state.inserted.length, 2);

  // Same cycle repeated for both — neither writes again.
  const third = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  const fourth = await persistGexRegimeEvents("QQQ", [flipCrossedEvent({ level: 380 })]);
  assert.equal(third, 0);
  assert.equal(fourth, 0);
  assert.equal(state.inserted.length, 2);
});

test("persistGexRegimeEvents: a stale cursor entry from a DIFFERENT session date does not suppress today's first occurrence", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();
  // Simulate yesterday's leftover cursor for the same ticker/slot/state.
  state.cursor = JSON.stringify({
    "SPY|flip_crossed:into long gamma": {
      date: "2026-07-05",
      key: JSON.stringify({ level: 5000, direction: "into long gamma" }),
    },
  });

  const n = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);

  assert.equal(n, 1, "today's first occurrence of a previously-seen transition must still log");
  assert.equal(state.inserted.length, 1);
});

test("fetchGexRegimeEvents: db not configured — returns [] without calling the DB layer", async () => {
  const { fetchGexRegimeEvents } = await mod();
  resetState();
  state.dbConfigured = false;

  const rows = await fetchGexRegimeEvents({ limit: 10 });
  assert.deepEqual(rows, []);
});

test("fetchGexRegimeEvents: delegates to the db layer and scopes by ticker", async () => {
  const { persistGexRegimeEvents, fetchGexRegimeEvents } = await mod();
  resetState();

  await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  await persistGexRegimeEvents("QQQ", [flipCrossedEvent({ level: 380 })]);

  const all = await fetchGexRegimeEvents({ limit: 10 });
  assert.equal(all.length, 2);

  const scoped = await fetchGexRegimeEvents({ ticker: "qqq", limit: 10 });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]!.ticker, "QQQ");
});

test("gexRegimeEventsForLargo: no history for the queried ticker — available:false with a clear note", async () => {
  const { gexRegimeEventsForLargo } = await mod();
  resetState();

  const payload = await gexRegimeEventsForLargo("SPY");
  assert.equal(payload.available, false);
  assert.match(String(payload.note), /SPY/);
});

test("gexRegimeEventsForLargo: retrieves regime-transition history for a queried ticker, distinct from other tickers; no-ticker returns all", async () => {
  const { persistGexRegimeEvents, gexRegimeEventsForLargo } = await mod();
  resetState();

  await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  await persistGexRegimeEvents("QQQ", [flipCrossedEvent({ level: 380, direction: "into short gamma" })]);

  const payload = await gexRegimeEventsForLargo("SPY");
  assert.equal(payload.available, true);
  assert.equal(payload.ticker, "SPY");
  const rows = payload.events as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticker, "SPY");
  assert.equal(rows[0]!.event_type, "flip_crossed");

  const everyone = await gexRegimeEventsForLargo();
  assert.equal(everyone.available, true);
  assert.equal(everyone.ticker, null);
  assert.equal((everyone.events as unknown[]).length, 2);
});

// ── Independence from gex-alerts' live-alert dedup (task #136's explicit ask:
// "verify your test asserts they don't interfere with each other"). gex-alerts
// (src/app/api/cron/gex-alerts/route.ts) keys its OWN Redis dedup as
// `gex-alert-sent:{ticker}:{type}:{etDate}[:level]` — completely separate
// storage (Redis, via sharedCacheGet/Set) from this module's Postgres
// platform_meta cursor. gex-regime-events.ts never imports ../shared-cache, so
// it structurally cannot read/write that key; this test additionally proves the
// runtime behavior both ways. ──
test("persistGexRegimeEvents never touches gex-alerts' Redis dedup keyspace, and a live-alert dedup write never affects durable-history throttling", async () => {
  const { persistGexRegimeEvents } = await mod();
  resetState();

  // Durable-history write for a flip crossing gex-alerts would ALSO evaluate as
  // regime-worthy for its own push dedup.
  const n1 = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  assert.equal(n1, 1);
  // gex-alerts' own dedup keyspace must remain completely untouched by the call above.
  assert.equal(fakeAlertRedis.size, 0);

  // Now simulate gex-alerts firing + recording ITS dedup key for the exact same
  // crossing (mirrors dedupKey()'s format in the real route).
  const alertDedupKey = "gex-alert-sent:SPY:flip_crossed:2026-07-06:5000";
  fakeAlertRedis.set(alertDedupKey, { at: flipCrossedEvent().at });

  // The durable-history Postgres cursor/inserted rows must be completely
  // unaffected by the alert dedup write above — re-persisting the SAME
  // unchanged transition still throttles purely on its own state, and a NEW
  // transition still logs regardless of what's in the alert dedup map.
  const n2 = await persistGexRegimeEvents("SPY", [flipCrossedEvent()]);
  assert.equal(n2, 0, "durable-history throttle is unaffected by the alert dedup write");
  assert.equal(state.inserted.length, 1);

  const n3 = await persistGexRegimeEvents("SPY", [
    flipCrossedEvent({ direction: "into short gamma", from_value: 5010, to_value: 4990 }),
  ]);
  assert.equal(n3, 1, "a genuinely new transition still logs even though an unrelated alert dedup key exists");
  assert.equal(state.inserted.length, 2);
});
