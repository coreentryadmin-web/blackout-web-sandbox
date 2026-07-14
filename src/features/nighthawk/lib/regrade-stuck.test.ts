import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIMIT,
  isStuckNighthawkOutcome,
  isoDaysBefore,
  regradeStuckNighthawkOutcomes,
  RESOLVER_LOOKBACK_DAYS,
  type DailyBar,
  type RegradeStuckDeps,
} from "./regrade-stuck";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

// "Today" for every test: the date the 12 stuck rows were found (2026-07-14). The
// resolver-lookback cutoff is therefore 2026-07-07: the 07-06 edition is outside the
// cron's window (the H-2 permanent-orphan case, stuck), while 07-07..07-10 editions
// are still >= the cutoff — in-window, the cron's job.
const TODAY = "2026-07-14";

function row(over: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-07-06",
    ticker: "AAPL",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    score: 60,
    sector: "Technology",
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "pending",
    created_at: "2026-07-06T22:00:00.000Z",
    ...over,
  };
}

/** Hermetic dep harness: in-memory rows, canned bars, persistence mutates the row so
 *  a second run sees the graded state exactly like the real WHERE outcome='pending'
 *  UPDATE + pending-only fetch would. */
function harness(rows: NighthawkPlayOutcomeRow[], bars: Record<string, DailyBar | null>) {
  const persisted: Array<{ id: number; outcome: string }> = [];
  const deps: RegradeStuckDeps = {
    fetchPending: async () => rows.filter((r) => r.outcome === "pending"),
    fetchDailyBar: async (ticker) => bars[ticker] ?? null,
    persist: async (id, patch) => {
      const target = rows.find((r) => r.id === id);
      // Mirror updateNighthawkPlayOutcome's guard: only a pending row is writable.
      if (target && target.outcome === "pending") {
        target.outcome = patch.outcome;
        target.next_day_open = patch.next_day_open;
        target.next_day_close = patch.next_day_close;
        target.session_high = patch.session_high;
        target.session_low = patch.session_low;
        target.hit_target = patch.hit_target;
        target.hit_stop = patch.hit_stop;
        persisted.push({ id, outcome: patch.outcome });
      }
    },
    today: () => TODAY,
  };
  return { deps, persisted };
}

test("isoDaysBefore: pure calendar arithmetic across month boundaries", () => {
  assert.equal(isoDaysBefore("2026-07-14", 7), "2026-07-07");
  assert.equal(isoDaysBefore("2026-07-06", 7), "2026-06-29");
  assert.equal(isoDaysBefore("2026-07-14", 0), "2026-07-14");
});

test("isStuckNighthawkOutcome: pending beyond the resolver lookback is stuck; in-window and graded rows are not", () => {
  // 07-06 < cutoff 07-07 → the cron will never see it again → stuck.
  assert.equal(isStuckNighthawkOutcome(row({ edition_for: "2026-07-06" }), TODAY), true);
  // Exactly at the cutoff (edition_for == today − 7d): fetchPendingNighthawkOutcomes'
  // `>=` still returns it to the cron, so the repair must leave it alone.
  assert.equal(isStuckNighthawkOutcome(row({ edition_for: "2026-07-07" }), TODAY), false);
  // Fresh pending row: the cron's job.
  assert.equal(isStuckNighthawkOutcome(row({ edition_for: "2026-07-13" }), TODAY), false);
  // Old but already graded: no repair needed.
  assert.equal(
    isStuckNighthawkOutcome(row({ edition_for: "2026-07-01", outcome: "target" }), TODAY),
    false
  );
});

test("stuck LONG whose session never traded back into the band regrades to 'unfilled' (the H-1 class)", async () => {
  // AAPL@07-06 shape: published band 198–202, stock gapped away — session low 205
  // stayed above the band top all day. Pre-fix this write threw on the CHECK.
  const rows = [row({ id: 11, ticker: "AAPL", edition_for: "2026-07-06" })];
  const { deps, persisted } = harness(rows, {
    AAPL: { o: 206, h: 212, l: 205, c: 210 },
  });

  const result = await regradeStuckNighthawkOutcomes({}, deps);

  assert.equal(result.matched, 1);
  assert.equal(result.regraded, 1);
  assert.deepEqual(persisted, [{ id: 11, outcome: "unfilled" }]);
  assert.equal(result.rows[0].outcome, "unfilled");
  assert.equal(rows[0].outcome, "unfilled");
});

test("stuck rows regrade to target/stop under the same current rules the cron applies", async () => {
  const rows = [
    // Filled (low 199 within band) and ran through target 215.
    row({ id: 21, ticker: "AMZN", edition_for: "2026-07-01" }),
    // Filled and broke the stop 190 intraday.
    row({ id: 22, ticker: "WFC", edition_for: "2026-07-01" }),
  ];
  const { deps, persisted } = harness(rows, {
    AMZN: { o: 201, h: 216, l: 199, c: 214 },
    WFC: { o: 200, h: 203, l: 188, c: 189 },
  });

  const result = await regradeStuckNighthawkOutcomes({}, deps);

  assert.equal(result.regraded, 2);
  assert.deepEqual(
    persisted.map((p) => p.outcome),
    ["target", "stop"]
  );
});

test("dry-run resolves every stuck row but persists NOTHING", async () => {
  const rows = [
    row({ id: 31, ticker: "AAPL", edition_for: "2026-07-06" }),
    row({ id: 32, ticker: "CSX", edition_for: "2026-07-06", entry_range_low: 30, entry_range_high: 31, target: 34, stop: 28 }),
  ];
  const { deps, persisted } = harness(rows, {
    AAPL: { o: 206, h: 212, l: 205, c: 210 },
    CSX: { o: 31.5, h: 33, l: 31.2, c: 32.5 },
  });

  const result = await regradeStuckNighthawkOutcomes({ dryRun: true }, deps);

  assert.equal(result.dry_run, true);
  assert.equal(result.matched, 2);
  assert.equal(result.regraded, 0, "dry-run must never count a write");
  assert.equal(persisted.length, 0, "dry-run must never persist");
  // ...but it still reports what WOULD happen, per row.
  assert.deepEqual(
    result.rows.map((r) => r.outcome),
    ["unfilled", "unfilled"]
  );
  assert.equal(rows[0].outcome, "pending");
  assert.equal(rows[1].outcome, "pending");
});

test("idempotent: a second run after a real run matches nothing and writes nothing", async () => {
  const rows = [row({ id: 41, ticker: "AAPL", edition_for: "2026-07-06" })];
  const { deps, persisted } = harness(rows, { AAPL: { o: 206, h: 212, l: 205, c: 210 } });

  const first = await regradeStuckNighthawkOutcomes({}, deps);
  assert.equal(first.regraded, 1);

  const second = await regradeStuckNighthawkOutcomes({}, deps);
  assert.equal(second.matched, 0, "graded rows are no longer pending — selector can never re-match");
  assert.equal(second.regraded, 0);
  assert.equal(persisted.length, 1, "no second write");
});

test("bounded: processes at most `limit` rows per run and reports the full matched count", async () => {
  const rows = [
    row({ id: 51, ticker: "AAPL", edition_for: "2026-07-06" }),
    row({ id: 52, ticker: "CSX", edition_for: "2026-07-06" }),
    row({ id: 53, ticker: "MAGS", edition_for: "2026-07-06" }),
  ];
  const bar: DailyBar = { o: 206, h: 212, l: 205, c: 210 };
  const { deps, persisted } = harness(rows, { AAPL: bar, CSX: bar, MAGS: bar });

  const result = await regradeStuckNighthawkOutcomes({ limit: 2 }, deps);

  assert.equal(result.matched, 3, "matched reports the whole stuck population");
  assert.equal(result.regraded, 2, "but only `limit` rows are written this run");
  assert.equal(persisted.length, 2);
  assert.ok(DEFAULT_LIMIT >= 12, "default limit must cover the known 12-row backlog in one run");
});

test("a stuck row with no session bar is skipped, stays pending, and re-matches next run (honest)", async () => {
  const rows = [row({ id: 61, ticker: "PG", edition_for: "2026-07-06" })];
  const { deps, persisted } = harness(rows, { PG: null });

  const result = await regradeStuckNighthawkOutcomes({}, deps);

  assert.equal(result.matched, 1);
  assert.equal(result.skipped_no_bar, 1);
  assert.equal(result.regraded, 0);
  assert.equal(persisted.length, 0);
  assert.equal(rows[0].outcome, "pending");

  const again = await regradeStuckNighthawkOutcomes({}, deps);
  assert.equal(again.matched, 1, "still stuck — visible on every run until a bar exists");
});

test("in-window pending rows are left to the cron even when mixed with stuck ones", async () => {
  const rows = [
    row({ id: 71, ticker: "AAPL", edition_for: "2026-07-06" }), // stuck
    row({ id: 72, ticker: "META", edition_for: "2026-07-10" }), // cutoff is 07-07 → in-window
  ];
  const { deps, persisted } = harness(rows, {
    AAPL: { o: 206, h: 212, l: 205, c: 210 },
    META: { o: 206, h: 212, l: 205, c: 210 },
  });

  const result = await regradeStuckNighthawkOutcomes({}, deps);

  assert.equal(result.matched, 1);
  assert.deepEqual(persisted.map((p) => p.id), [71]);
  assert.equal(rows[1].outcome, "pending", "in-window row untouched — the cron owns it");
});

test("a per-row failure lands in errors and does not abort the rest of the batch", async () => {
  const rows = [
    row({ id: 81, ticker: "BOOM", edition_for: "2026-07-06" }),
    row({ id: 82, ticker: "AAPL", edition_for: "2026-07-06" }),
  ];
  const { deps, persisted } = harness(rows, { AAPL: { o: 206, h: 212, l: 205, c: 210 } });
  const failingDeps: RegradeStuckDeps = {
    ...deps,
    fetchDailyBar: async (ticker) => {
      if (ticker === "BOOM") throw new Error("polygon 502");
      return deps.fetchDailyBar(ticker, "");
    },
  };

  const result = await regradeStuckNighthawkOutcomes({}, failingDeps);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /BOOM@2026-07-06/);
  assert.equal(result.regraded, 1, "the healthy row still graded");
  assert.deepEqual(persisted.map((p) => p.id), [82]);
});

test("the selector's lookback constant mirrors the resolver default", () => {
  // resolvePendingNighthawkOutcomes (play-outcomes.ts) defaults lookbackDays to 7;
  // "stuck" is defined relative to that. If the resolver default moves, this constant
  // (and this test) must move with it — see the constant's doc.
  assert.equal(RESOLVER_LOOKBACK_DAYS, 7);
});
