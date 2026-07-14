// Counterfactual SKIP grading tests (PR-C). Pure-core table tests over fixture bars
// (premium basis with an OCC path, underlying basis without, ungradeable, tie
// ordering) plus a hermetic data-layer test with "../db" and the Polygon provider
// mocked. Dynamic imports in the module under test use RELATIVE specifiers, so the
// mocks here register against the same resolved URLs.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ── Data-layer mocks (registered BEFORE any import of the module under test) ─────
const dbState = {
  configured: true,
  queries: [] as Array<{ text: string; values: unknown[] | undefined }>,
  selectRows: [] as Array<Record<string, unknown>>,
  failAll: false,
};
mock.module("../db", {
  namedExports: {
    dbConfigured: () => dbState.configured,
    dbQuery: async (text: string, values?: unknown[]) => {
      if (dbState.failAll) throw new Error("db down");
      dbState.queries.push({ text, values });
      if (/^\s*SELECT/i.test(text)) return { rows: dbState.selectRows };
      return { rows: [] };
    },
  },
});
const polyState = {
  calls: [] as Array<{ symbol: string; from: string }>,
  bars: [] as Array<Record<string, number>>,
};
mock.module("../providers/polygon-largo", {
  namedExports: {
    fetchAggBars: async (symbol: string, _m: number, _ts: string, from: string) => {
      polyState.calls.push({ symbol, from });
      return polyState.bars;
    },
  },
});

// tsx transpiles tests to CJS (no top-level await) — dynamic-import the module
// under test inside each test, same idiom as entry-context.test.ts.
const mod = () => import("./skip-grading");

// 2026-07-10 is a Friday; ET is EDT (UTC-4) → "10:00" ET = 14:00Z.
const et = (hhmm: string, date = "2026-07-10") => Date.parse(`${date}T${hhmm}:00-04:00`);
const NOW = et("16:05");

type Bar = { t: number; h: number; l: number; c: number };
const bar = (tEt: string, c: number, h = c, l = c): Bar => ({ t: et(tEt), h, l, c });

// ── Premium basis (OCC path reconstructable) ─────────────────────────────────────

test("premium basis: entry = first bar close after the block, +100% target → would_have_won", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    premiumBars: [
      bar("09:55", 0.8), // before the block — never the entry
      bar("10:00", 1.0, 1.05, 0.95), // entry bar → entry 1.00
      bar("10:05", 1.4, 1.5, 1.3),
      bar("10:10", 1.9, 2.05, 1.8), // high touches target 2.00
    ],
    underlyingBars: null,
    nowMs: NOW,
  });
  assert.equal(v.basis, "premium");
  assert.equal(v.verdict, "would_have_won");
  assert.equal(v.outcome, "doubled");
  assert.equal(v.pnl_pct, 100);
  assert.equal(v.entry, 1);
  assert.equal(v.exit, 2);
  assert.equal(v.move_pct, null); // underlying move is never reported on premium basis
  assert.equal(v.graded_at, new Date(NOW).toISOString());
});

test("premium basis: -50% stop → would_have_lost", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    premiumBars: [bar("10:00", 1.0), bar("10:05", 0.6, 0.65, 0.45)], // low touches stop 0.50
    nowMs: NOW,
  });
  assert.equal(v.verdict, "would_have_lost");
  assert.equal(v.outcome, "stopped");
  assert.equal(v.pnl_pct, -50);
  assert.equal(v.exit, 0.5);
});

test("premium basis: stop AND target inside the same bar grades as the STOP (conservative tie rule)", async () => {
  // Intrabar order is unknowable. Counting the target would inflate the blocked-
  // value evidence and pressure gates open on data we do not actually have — the
  // counterfactual must always err AGAINST the skipped play.
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    premiumBars: [bar("10:00", 1.0), bar("10:05", 1.2, 2.5, 0.4)], // touches 0.50 AND 2.00
    nowMs: NOW,
  });
  assert.equal(v.outcome, "stopped");
  assert.equal(v.verdict, "would_have_lost");
  assert.equal(v.pnl_pct, -50);
});

test("premium basis: the entry bar's own high/low never trigger (subsequent bars only)", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    // Entry bar touches BOTH exits intrabar — but entry is its close, and the plan
    // is graded on strictly-later bars, so neither fires.
    premiumBars: [bar("10:00", 1.0, 3.0, 0.3), bar("10:10", 1.1, 1.15, 1.05)],
    nowMs: NOW,
  });
  assert.equal(v.outcome, "time_stop");
  assert.equal(v.pnl_pct, 10);
  assert.equal(v.verdict, "would_have_won");
});

test("premium basis: a dead-flat time_stop (pnl 0) is would_have_lost — ties never credit the skip", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    premiumBars: [bar("10:00", 1.0), bar("11:00", 1.0)],
    nowMs: NOW,
  });
  assert.equal(v.outcome, "time_stop");
  assert.equal(v.pnl_pct, 0);
  assert.equal(v.verdict, "would_have_lost");
});

test("premium bars with nothing after entry fall back to the underlying basis, never a fabricated premium grade", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    premiumBars: [bar("10:00", 1.0)], // entry bar only — no subsequent contract bar
    underlyingBars: [bar("10:00", 500), bar("10:30", 505)],
    nowMs: NOW,
  });
  assert.equal(v.basis, "underlying");
  assert.equal(v.verdict, "would_have_won");
  assert.equal(v.pnl_pct, null);
});

// ── Underlying basis (no OCC pinned — the honest fallback) ───────────────────────

test("underlying basis: long graded on direction to the 15:30 close-equivalent, premium P&L never fabricated", async () => {
  const { gradeSkippedPlay } = await mod();
  const v = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("10:00"),
    underlyingBars: [
      bar("09:55", 498),
      bar("10:00", 500), // entry
      bar("12:00", 507),
      bar("15:30", 505), // last usable close inside the plan window
      bar("15:45", 490), // past the hard exit — must be ignored
    ],
    nowMs: NOW,
  });
  assert.equal(v.basis, "underlying");
  assert.equal(v.verdict, "would_have_won");
  assert.equal(v.entry, 500);
  assert.equal(v.exit, 505);
  assert.equal(v.move_pct, 1);
  assert.equal(v.pnl_pct, null);
  assert.equal(v.outcome, null);
});

test("underlying basis: short wins on a down move, loses a dead-flat tie", async () => {
  const { gradeSkippedPlay } = await mod();
  const down = gradeSkippedPlay({
    direction: "short",
    blockedAtMs: et("10:00"),
    underlyingBars: [bar("10:00", 500), bar("14:00", 495)],
    nowMs: NOW,
  });
  assert.equal(down.verdict, "would_have_won");
  assert.equal(down.move_pct, -1);

  // exit == entry: strict inequality — a flat move is NOT blocked value.
  const flat = gradeSkippedPlay({
    direction: "short",
    blockedAtMs: et("10:00"),
    underlyingBars: [bar("10:00", 500), bar("14:00", 500)],
    nowMs: NOW,
  });
  assert.equal(flat.verdict, "would_have_lost");
});

// ── Ungradeable (honest limits) ──────────────────────────────────────────────────

test("ungradeable: no bars, no direction, post-15:30 block, or no bar after entry — each with its reason", async () => {
  const { gradeSkippedPlay } = await mod();

  const noBars = gradeSkippedPlay({ direction: "long", blockedAtMs: et("10:00"), nowMs: NOW });
  assert.equal(noBars.verdict, "ungradeable");
  assert.equal(noBars.basis, null);
  assert.match(noBars.reason!, /no bar data available/);

  const noDir = gradeSkippedPlay({
    direction: null,
    blockedAtMs: et("10:00"),
    underlyingBars: [bar("10:00", 500), bar("11:00", 501)],
    nowMs: NOW,
  });
  assert.match(noDir.reason!, /no long\/short direction/);

  const late = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("15:31"),
    underlyingBars: [bar("15:31", 500), bar("15:32", 501)],
    nowMs: NOW,
  });
  assert.match(late.reason!, /blocked after the 15:30 ET hard exit/);

  const noExit = gradeSkippedPlay({
    direction: "long",
    blockedAtMs: et("15:29"),
    underlyingBars: [bar("15:29", 500), bar("15:45", 505)], // only bar after entry is past the window
    nowMs: NOW,
  });
  assert.equal(noExit.verdict, "ungradeable");
  assert.match(noExit.reason!, /no underlying bars after the counterfactual entry/);
});

// ── Data layer (hermetic: db + provider mocked) ──────────────────────────────────

test("runSkipGrading: idempotent column ALTER, finished-sessions-only SELECT, verdict persisted per row", async () => {
  const { runSkipGrading } = await mod();
  dbState.queries = [];
  dbState.selectRows = [
    {
      id: 7,
      observed_at: new Date(et("10:00")).toISOString(),
      session_date: "2026-07-10",
      ticker: "SPXW", // index root → bars must be fetched under I:SPX
      gate_failed: "tape_alignment",
      direction: "long",
    },
    {
      id: 8,
      observed_at: new Date(et("10:05")).toISOString(),
      session_date: "2026-07-10",
      ticker: "SPXW",
      gate_failed: "score_floor",
      direction: null, // → ungradeable, still persisted
    },
  ];
  polyState.calls = [];
  polyState.bars = [
    { t: et("10:00"), h: 6301, l: 6299, c: 6300 },
    { t: et("14:00"), h: 6331, l: 6329, c: 6330 },
  ];

  const summary = await runSkipGrading({ days: 3, nowMs: NOW });
  assert.equal(summary.available, true);
  assert.equal(summary.scanned, 2);
  assert.equal(summary.graded, 1);
  assert.equal(summary.ungradeable, 1);
  assert.equal(summary.errors, 0);

  // Migration: the same ALTER-IF-NOT-EXISTS idiom db.ts uses for entry_context.
  assert.ok(dbState.queries.some((q) => /ADD COLUMN IF NOT EXISTS counterfactual_json JSONB/.test(q.text)));
  // Selection: only NULL counterfactuals, only FINISHED sessions (session_date < today ET).
  const select = dbState.queries.find((q) => /^\s*SELECT/i.test(q.text))!;
  assert.match(select.text, /counterfactual_json IS NULL/);
  assert.match(select.text, /session_date < \$2/);
  // Index-root mapping: one cached fetch, under the I: namespace.
  assert.deepEqual(polyState.calls, [{ symbol: "I:SPX", from: "2026-07-10" }]);
  // Persisted verdicts, keyed by row id.
  const updates = dbState.queries.filter((q) => /^UPDATE zerodte_scan_rejections/.test(q.text));
  assert.equal(updates.length, 2);
  const graded = JSON.parse(updates[0]!.values![0] as string);
  assert.equal(updates[0]!.values![1], 7);
  assert.equal(graded.basis, "underlying");
  assert.equal(graded.verdict, "would_have_won");
  const ungr = JSON.parse(updates[1]!.values![0] as string);
  assert.equal(updates[1]!.values![1], 8);
  assert.equal(ungr.verdict, "ungradeable");
});

test("runSkipGrading / fetchGradedSkips fail soft — a dead DB is a structured summary / empty list, never a throw", async () => {
  const { runSkipGrading, fetchGradedSkips } = await mod();
  dbState.failAll = true;
  try {
    const summary = await runSkipGrading({ days: 3, nowMs: NOW });
    assert.equal(summary.available, false);
    assert.ok(summary.note);
    assert.deepEqual(await fetchGradedSkips({ sinceYmd: "2026-07-01", throughYmd: "2026-07-10" }), []);
  } finally {
    dbState.failAll = false;
  }

  dbState.configured = false;
  try {
    const summary = await runSkipGrading({ days: 3, nowMs: NOW });
    assert.equal(summary.available, false);
    assert.match(summary.note!, /not configured/);
  } finally {
    dbState.configured = true;
  }
});
