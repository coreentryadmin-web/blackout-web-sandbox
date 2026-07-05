import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { DayTradeSignal } from "./day-trade-types";

// day-trade-agent.ts pulls in @/lib/platform/spx-service -> ... -> gex-positioning.ts,
// which imports the "server-only" package. That package throws unconditionally when
// required outside Next's own bundler (it relies on a webpack alias swap for the real
// client/server split), so a plain node:test run needs the same stub every other test
// in this repo already uses for the same transitive-import shape (see
// nighthawk/positioning.test.ts, providers/gex-positioning.test.ts, etc.).
mock.module("server-only", { namedExports: {} });

let isMarketClosed: typeof import("./day-trade-agent").isMarketClosed;
let expireSignalsAtMarketClose: typeof import("./day-trade-agent").expireSignalsAtMarketClose;

before(async () => {
  ({ isMarketClosed, expireSignalsAtMarketClose } = await import("./day-trade-agent"));
});

function signal(phase: DayTradeSignal["phase"]): DayTradeSignal {
  return {
    ticker: "SPY",
    direction: "long",
    thesis: "test",
    contract: "SPY 500C",
    entry: "1.00-1.20",
    target: "2.00",
    stop: "0.50",
    phase,
  };
}

// ── isMarketClosed: the DST-offset bug (task #169) ─────────────────────────────────
//
// The old implementation approximated the ET/UTC offset by calendar month
// ("month >= 3 && month <= 11 ? -4 : -5") instead of the real US DST boundary
// (2nd Sunday of March -> 1st Sunday of November). 2026's real boundary is
// Mar 8 (DST starts) -> Nov 1 (DST ends), confirmed via Intl/tzdata below.

test("2026 DST boundary sanity check (Intl/tzdata, not the old hand-rolled month math)", () => {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    })
      .format(d)
      .split(", ")
      .pop();
  assert.equal(fmt(new Date("2026-03-07T12:00:00Z")), "EST"); // Sat before DST start
  assert.equal(fmt(new Date("2026-03-08T12:00:00Z")), "EDT"); // Sun DST starts
  assert.equal(fmt(new Date("2026-11-01T12:00:00Z")), "EST"); // Sun DST ends
});

test("isMarketClosed: exact repro — Mar 5 2026 20:45 UTC is real ET 15:45 (pre-DST, market still open) -> false", () => {
  // Old buggy code treated March as EDT (-4) unconditionally: 20:45 - 4h = 16:45 ET,
  // already past the 16:00 close (a full hour early — real EST offset is -5, giving
  // the true 15:45 ET). Confirmed live repro from the audit; must now return false.
  const now = new Date("2026-03-05T20:45:00.000Z");
  assert.equal(isMarketClosed(now), false);
});

test("isMarketClosed: genuine post-close timestamp on the same pre-DST day -> true", () => {
  // 2026-03-05T21:15:00Z is real ET 16:15 (EST) — genuinely past the 16:00 close.
  const now = new Date("2026-03-05T21:15:00.000Z");
  assert.equal(isMarketClosed(now), true);
});

test("isMarketClosed: the 16:00 ET close-minute boundary matches the canonical isBeforeOrAtMarketCloseEt semantics", () => {
  // 2026-07-06 is a normal EDT trading Monday. 20:00 UTC = 16:00 ET exactly.
  // isBeforeOrAtMarketCloseEt (session.test.ts) deliberately keeps a session "active
  // through its close" at the 16:00 minute itself, flipping to closed at 16:01 — the
  // same boundary this function now inherits by delegating to that helper.
  assert.equal(isMarketClosed(new Date("2026-07-06T19:59:00.000Z")), false); // 15:59 ET
  assert.equal(isMarketClosed(new Date("2026-07-06T20:00:00.000Z")), false); // 16:00 ET
  assert.equal(isMarketClosed(new Date("2026-07-06T20:01:00.000Z")), true); // 16:01 ET
});

test("isMarketClosed: November after DST truly ends is handled correctly (real EST, not the old hand-rolled EDT guess)", () => {
  // 2026-11-10 (Tue) is after DST ended (Nov 1) — real offset is EST (-5).
  // The old code's "month <= 11 ? -4 : -5" branch treated ALL of November as
  // EDT (-4), which would read 20:45 UTC as 16:45 ET (already closed) instead
  // of the true 15:45 ET (still open) — the same 1-hour-early bug as March.
  assert.equal(isMarketClosed(new Date("2026-11-10T20:45:00.000Z")), false); // real ET 15:45, open
  assert.equal(isMarketClosed(new Date("2026-11-10T21:15:00.000Z")), true); // real ET 16:15, closed
});

test("isMarketClosed: weekend is always closed regardless of clock time (the other bug this fix closes — no weekday/holiday gate existed before)", () => {
  // 2026-07-11 is a Saturday, 14:00 ET (well within the old code's "open" hours).
  assert.equal(isMarketClosed(new Date("2026-07-11T18:00:00.000Z")), true);
});

test("isMarketClosed: NYSE holiday is always closed regardless of clock time", () => {
  // 2026-07-03 is the Independence Day observed holiday (Friday) — a weekday on
  // the clock, but not a trading day. 15:00 UTC = 11:00 ET, well within market hours
  // on a real trading day.
  assert.equal(isMarketClosed(new Date("2026-07-03T15:00:00.000Z")), true);
});

// ── expireSignalsAtMarketClose ──────────────────────────────────────────────────────

test("expireSignalsAtMarketClose: leaves CANDIDATE/WATCH untouched at the exact repro pre-close timestamp", () => {
  const signals = [signal("CANDIDATE"), signal("WATCH"), signal("ACTIONABLE")];
  const out = expireSignalsAtMarketClose(signals, new Date("2026-03-05T20:45:00.000Z"));
  assert.deepEqual(out.map((s) => s.phase), ["CANDIDATE", "WATCH", "ACTIONABLE"]);
});

test("expireSignalsAtMarketClose: expires CANDIDATE/WATCH but not ACTIONABLE once genuinely past close", () => {
  const signals = [signal("CANDIDATE"), signal("WATCH"), signal("ACTIONABLE")];
  const out = expireSignalsAtMarketClose(signals, new Date("2026-03-05T21:15:00.000Z"));
  assert.deepEqual(out.map((s) => s.phase), ["EXPIRED", "EXPIRED", "ACTIONABLE"]);
});
