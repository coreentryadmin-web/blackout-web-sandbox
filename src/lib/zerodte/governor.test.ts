import { test } from "node:test";
import assert from "node:assert/strict";

// governor.ts's only stateful dependency is @/lib/shared-cache, which (with no
// REDIS_URL set, as here) transparently uses its own in-memory fallback map — so
// the record/load round-trip below exercises the REAL persistence code path, no
// mock.module scaffolding needed. Each test uses its own session date to keep the
// shared in-memory map from leaking state between tests.
import {
  deriveGovernorFromLedger,
  evaluateZeroDteGovernor,
  loadRecordedGovernorStops,
  mergeGovernorStops,
  recordGovernorStops,
  GOVERNOR_MAX_CONCURRENT_PLANS,
  GOVERNOR_MAX_SESSION_STOPS,
  GOVERNOR_REENTRY_LOCK_MS,
  type GovernorLedgerRow,
} from "./governor";

const NOW = Date.parse("2026-07-13T17:00:00Z");

function row(overrides: Partial<GovernorLedgerRow> = {}): GovernorLedgerRow {
  return {
    ticker: "NVDA",
    direction: "long",
    status: "OPEN",
    entry_premium: 4.0,
    trough_premium: 4.0,
    plan_outcome: null,
    ...overrides,
  };
}

// ── ledger-derived snapshot ────────────────────────────────────────────────────────

test("deriveGovernorFromLedger: non-CLOSED rows count as open — including null status (just committed)", () => {
  const snap = deriveGovernorFromLedger([
    row({ ticker: "A", status: "OPEN" }),
    row({ ticker: "B", status: "HOLD" }),
    row({ ticker: "C", status: "TRIM" }),
    row({ ticker: "D", status: null }), // committed this cycle, cron hasn't synced yet
    row({ ticker: "E", status: "CLOSED" }),
  ]);
  assert.deepEqual(snap.open_plans.map((p) => p.ticker).sort(), ["A", "B", "C", "D"]);
});

test("deriveGovernorFromLedger: a stop is detected from the graded plan_outcome OR the latched trough", () => {
  const snap = deriveGovernorFromLedger([
    // Graded stop (lazy grader already ran).
    row({ ticker: "MU", status: "CLOSED", plan_outcome: "stopped" }),
    // Ungraded but the latched trough crossed the -50% stop level (2.0 on a 4.0 entry).
    row({ ticker: "SPY", status: "CLOSED", trough_premium: 1.9 }),
    // Time-stop close, trough never near the stop — NOT a stop.
    row({ ticker: "QQQ", status: "CLOSED", trough_premium: 3.8 }),
    // Still open — its drawdown isn't a stop yet.
    row({ ticker: "AMD", status: "HOLD", trough_premium: 2.5 }),
  ]);
  assert.deepEqual(snap.stops.map((s) => s.ticker).sort(), ["MU", "SPY"]);
  assert.ok(snap.stops.every((s) => s.at_ms === null), "ledger stops carry no fabricated timestamp");
});

test("mergeGovernorStops: recorded (timestamped) events win over timeless ledger twins, unions the rest", () => {
  const merged = mergeGovernorStops(
    [
      { ticker: "MU", direction: "long", at_ms: null },
      { ticker: "SPY", direction: "long", at_ms: null },
    ],
    [
      { ticker: "MU", direction: "long", at_ms: NOW - 5 * 60_000 },
      { ticker: "AMD", direction: "long", at_ms: NOW - 60_000 },
    ]
  );
  const byTicker = new Map(merged.map((s) => [s.ticker, s]));
  assert.equal(merged.length, 3);
  assert.equal(byTicker.get("MU")!.at_ms, NOW - 5 * 60_000);
  assert.equal(byTicker.get("SPY")!.at_ms, null);
  assert.equal(byTicker.get("AMD")!.at_ms, NOW - 60_000);
});

// ── pure rules ─────────────────────────────────────────────────────────────────────

test("governor: 3 stops halt the session — single dominating block", () => {
  const stops = ["SPY", "MU", "AMD"].map((t) => ({ ticker: t, direction: "long" as const, at_ms: null }));
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: [], stops }, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
  assert.equal(blocks[0]!.threshold, GOVERNOR_MAX_SESSION_STOPS);
});

test("governor: concurrency cap at 3 open plans (2 passes, 3 blocks)", () => {
  const two = [
    { ticker: "TSLA", direction: "long" as const },
    { ticker: "AMZN", direction: "long" as const },
  ];
  const ok = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: two, stops: [] }, NOW);
  assert.deepEqual(ok, []);
  const three = [...two, { ticker: "GOOGL", direction: "long" as const }];
  const blocked = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: three, stops: [] }, NOW);
  assert.deepEqual(blocked.map((b) => b.code), ["governor_max_concurrent"]);
  assert.equal(blocked[0]!.threshold, GOVERNOR_MAX_CONCURRENT_PLANS);
});

test("governor/B-3: QQQ short against an OPEN SPY long is a correlated conflict — blocked", () => {
  // 7/13 ran exactly this pair live: SPY long (09:55) and QQQ short (10:20) at once.
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  const blocked = evaluateZeroDteGovernor({ ticker: "QQQ", direction: "short" }, snap, NOW);
  assert.deepEqual(blocked.map((b) => b.code), ["correlated_conflict"]);
  assert.match(blocked[0]!.reason, /OPEN SPY long/, "the open ticker is named in the detail");
});

test("governor/B-3: direction AGREEMENT with the open correlated plan is allowed", () => {
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "QQQ", direction: "long" }, snap, NOW), []);
});

test("governor/B-3: no open plays — nothing to conflict with", () => {
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "QQQ", direction: "short" }, { open_plans: [], stops: [] }, NOW),
    []
  );
});

test("governor/B-3: v1 groups are the index/ETF complex only — a single name doesn't trip it", () => {
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "short" }, snap, NOW), []);
});

test("governor: 20-min same-direction re-entry lock — inside blocks, outside/opposite/untimed pass", () => {
  const stopAt = NOW - 10 * 60_000; // 10 minutes ago
  const snap = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: stopAt }] };

  const locked = evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, snap, NOW);
  assert.deepEqual(locked.map((b) => b.code), ["governor_reentry_lock"]);
  assert.match(locked[0]!.reason, /10 more minutes/);

  // Lock expired.
  const later = NOW - GOVERNOR_REENTRY_LOCK_MS - (NOW - stopAt);
  const expired = evaluateZeroDteGovernor(
    { ticker: "META", direction: "short" },
    { open_plans: [], stops: [{ ticker: "META", direction: "short", at_ms: later }] },
    NOW
  );
  assert.deepEqual(expired, []);

  // Opposite direction is a different trade — not locked.
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "META", direction: "long" }, snap, NOW), []);

  // Untimed (ledger-only) stop can't drive the timed lock — never fabricate timing.
  const untimed = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: null }] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, untimed, NOW), []);
});

// ── persistence round-trip (real shared-cache in-memory fallback) ──────────────────

test("governor state: a simulated 3-stop session persists, reloads, and halts", async () => {
  const day = "2099-01-02"; // unique per test — the fallback map is module-global
  await recordGovernorStops(day, [{ ticker: "SPY", direction: "long", at_ms: NOW - 30 * 60_000 }]);
  await recordGovernorStops(day, [{ ticker: "MU", direction: "long", at_ms: NOW - 20 * 60_000 }]);
  await recordGovernorStops(day, [{ ticker: "AMD", direction: "long", at_ms: NOW - 5 * 60_000 }]);

  const recorded = await loadRecordedGovernorStops(day);
  assert.equal(recorded.length, 3);

  const snap = { open_plans: [], stops: mergeGovernorStops([], recorded) };
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
});

test("governor state: first-write-wins per ticker — re-observing a stopped row never resets its lock clock", async () => {
  const day = "2099-01-03";
  const firstSeen = NOW - 15 * 60_000;
  await recordGovernorStops(day, [{ ticker: "META", direction: "short", at_ms: firstSeen }]);
  // The same stopped row observed again on a later sync tick.
  await recordGovernorStops(day, [{ ticker: "META", direction: "short", at_ms: NOW }]);

  const recorded = await loadRecordedGovernorStops(day);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.at_ms, firstSeen);
});

test("governor state: an empty/unknown session date loads as no stops (never a guess)", async () => {
  assert.deepEqual(await loadRecordedGovernorStops("2099-01-04"), []);
});
