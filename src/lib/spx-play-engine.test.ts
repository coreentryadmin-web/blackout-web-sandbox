// Regression coverage for task/finding: "SPX Slayer's 3-second-polled dashboard
// hardcodes signal_committed: true even when nothing was actually persisted."
//
// Root cause (docs/audit/FINDINGS.md): evaluateOpenPlay()'s shared return tail
// (spx-play-engine.ts) set `signal_committed: true` as a bare literal, never
// consulting the `mutate` flag every DB write in that same function IS gated on.
// A mutate:false call (the member-facing 3s poll, spx-evaluator.ts's
// readSpxPlaySnapshot) could show a full "SELL — TARGET" card whose
// signal_committed claimed it was graded/persisted when nothing was written —
// only the mutate:true cron path (runSpxEvaluator, every 5 min) actually commits.
//
// No test previously exercised evaluateOpenPlay's mutate:true vs mutate:false
// behavior at all (signal_committed only ever appeared as a hardcoded fixture
// value in other suites) — that gap is exactly why this shipped undetected.
//
// This file drives the real evaluateSpxPlay()/evaluateOpenPlay() + the real
// spx-play-store.ts, running spx-play-store in its already-supported in-memory
// fallback mode (dbConfigured() === false, driven by unsetting DATABASE_URL/
// DATABASE_PUBLIC_URL below) so persistence can be observed directly — via
// loadOpenPlay()/mfe_pts — without touching a real database. Modules mocked
// below are either (a) import-time singletons/live-wall-clock reads that would
// make the suite non-deterministic, or (b) fire-and-forget observational
// side channels (shadow-factor logging, adaptive-gate telemetry, Discord) that
// are irrelevant to signal_committed and whose own transitive graphs pull in
// "server-only"-guarded provider modules if left real (same reason
// admin-spx-health.test.ts mocks providers/spx-signal-log rather than
// importing it for real). Everything on the actual open-play code path —
// spx-signals, spx-play-confirmations, spx-play-mtf, spx-desk-stale,
// spx-play-thesis, spx-play-config, spx-play-store — is the genuine
// production implementation.
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";
process.env.DISCORD_PLAY_WEBHOOK_URL = "";

import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";

let mockForceExit = false;

// Avoids instantiating ws/uw-socket's module-scope `uwSocket` WebSocket manager
// singleton (spx-play-gates.ts imports shouldBlockForTradingHalt from it, and
// spx-play-engine.ts statically imports spx-play-gates.ts) — same mock shape as
// spx-play-gates.test.ts.
mock.module("./ws/uw-socket", {
  namedExports: {
    shouldBlockForTradingHalt: () => ({ block: false, reason: null }),
  },
});

// isPastForceExitCutoff has no way to inject a fixed "now" from spx-play-engine.ts
// (it's called with zero args), so left real it would make forceExit's THETA-FLAT
// branch fire or not depending on wall-clock time when the suite happens to run —
// exactly the class of time-window bug this audit exists to catch. Mocked here for
// determinism; every other export this shared module provides (needed because both
// spx-play-engine.ts and spx-play-gates.ts import from it) is a fixed, inert default
// since neither is exercised by the open-play path under test.
mock.module("./spx-play-session-guards", {
  namedExports: {
    forceExitCutoffLabel: () => "3:50 PM ET",
    isPastForceExitCutoff: () => mockForceExit,
    isBeforeCashOpen: () => false,
    isPremarketPlanningWindow: () => false,
    isPastNoEntryCutoff: () => false,
    cashOpenLabel: () => "9:30 AM ET",
    noEntryCutoffLabel: () => "3:30 PM ET",
  },
});

// Shadow-mode factor logging + the retrospective snapshot log — every export
// here is dbConfigured()-guarded no-op in the real module, but the module's
// own import graph (UW/Polygon providers, BIE precedent search) pulls in
// "server-only"-guarded files that throw outside Next's server bundler. Mocked
// wholesale, same as admin-spx-health.test.ts.
mock.module("./providers/spx-signal-log", {
  namedExports: {
    maybeLogSpxPlay: async () => {},
    logSpxShadowFactors: async () => {},
    logSpxMacroPredictionsShadowFactor: async () => {},
    logSpxSkewShadowFactors: async () => {},
    logSpxEcosystemShadowFactors: async () => {},
    logMegaCapCatalystShadowFactors: async () => {},
    logSpxPrecedentsShadowFactor: async () => {},
    maybeLogSpxEngineSnapshot: async () => {},
  },
});

// loadAdaptivePlayGates ultimately reads spx-play-outcomes.ts; irrelevant to
// signal_committed and not worth dragging in for this suite. Shape matches
// AdaptivePlayGates's "inactive" default (see spx-play-telemetry.ts).
mock.module("./spx-play-telemetry", {
  namedExports: {
    loadAdaptivePlayGates: async () => ({
      active: false,
      stats: {
        cold_buy: { count: 0, win_rate: 0 },
        watch_promote: { count: 0, win_rate: 0 },
        total_closed: 0,
        days_of_data: 0,
      },
      global_min_score_boost: 0,
      promote_min_score_boost: 0,
      promote_blocked: false,
      promote_requires_claude: false,
      promote_block_reason: null,
      summary: "adaptive gates inactive (test)",
    }),
    effectiveFullMinScore: (base: number) => base,
    effectivePromoteMinScore: (base: number) => base,
  },
});

let evaluateSpxPlay: typeof import("./spx-play-engine").evaluateSpxPlay;
let openPlay: typeof import("./spx-play-store").openPlay;
let loadOpenPlay: typeof import("./spx-play-store").loadOpenPlay;

before(async () => {
  ({ evaluateSpxPlay } = await import("./spx-play-engine"));
  ({ openPlay, loadOpenPlay } = await import("./spx-play-store"));
});

beforeEach(() => {
  mockForceExit = false;
});

const EMPTY_TECHNICALS: PlayTechnicals = {
  available: false,
  price: 0,
  m1_bars: 0,
  m3_close: null,
  m5_close: null,
  m5_ema20: null,
  m5_rsi: null,
  m5_rsi_warning: null,
  m5_trend: "flat",
  m3_above_vwap: null,
  breakout: {
    pdh_break: false,
    pdl_break: false,
    hod_break: false,
    lod_break: false,
    vwap_reclaim: false,
    vwap_lost: false,
  },
  mtf: {
    m3_confirms_long: null,
    m3_confirms_short: null,
    m5_confirms_long: false,
    m5_confirms_short: false,
  },
};

function desk(price: number, overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  const now = new Date().toISOString();
  return {
    available: true,
    market_open: true,
    price,
    polled_at: now,
    as_of: now,
    source: "test",
    vix: 18,
    gex_walls: [],
    macro_events: [],
    flow_cluster_live: true,
    gex_age_ms: 1000,
    flow_data_age_ms: 1000,
    ...overrides,
  } as SpxDeskPayload;
}

/**
 * Seeds an in-memory open play (dbConfigured() is false throughout this file, so
 * spx-play-store.ts's own already-supported memory fallback holds the row — see
 * MEMORY_OPEN in spx-play-store.ts) whose entry_score equals the confluence score
 * evaluateSpxPlay will recompute against the same flat desk. Matching them exactly
 * keeps evaluateThesisBreak's drop/floor comparison a no-op (score === entryScore),
 * isolating each test to whichever exit trigger it actually sets up.
 */
async function seedOpenPlay(opts: {
  direction: "long" | "short";
  entryPrice: number;
  stop: number | null;
  target: number | null;
}) {
  const entryDesk = desk(opts.entryPrice);
  const { computeSpxConfluence } = await import("./spx-signals");
  const confluence = computeSpxConfluence(entryDesk);
  await openPlay({
    session_date: "2026-07-06",
    direction: opts.direction,
    entry_price: opts.entryPrice,
    entry_score: confluence?.score ?? 0,
    stop: opts.stop,
    target: opts.target,
    grade: "B",
    headline: "seed",
    opened_at: new Date().toISOString(),
  });
}

test("evaluateOpenPlay HOLD, mutate:false: signal_committed is false and nothing is persisted", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5100 });

  const payload = await evaluateSpxPlay(desk(5010), EMPTY_TECHNICALS, { mutate: false });

  assert.equal(payload.action, "HOLD");
  assert.equal(payload.signal_committed, false, "mutate:false must never claim a committed signal");

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen, "read-only poll must not close the play");
  assert.equal(stillOpen!.mfe_pts, 0, "read-only poll must not even bump mfe/mae peaks");
});

test("evaluateOpenPlay HOLD, mutate:true: signal_committed is true and the mfe peak is actually persisted", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5100 });

  const payload = await evaluateSpxPlay(desk(5010), EMPTY_TECHNICALS, { mutate: true });

  assert.equal(payload.action, "HOLD");
  assert.equal(payload.signal_committed, true, "mutate:true actually wrote the mfe/mae peak — must report committed");

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen);
  assert.equal(stillOpen!.mfe_pts, 10, "mutate:true must persist the updated mfe peak");
});

test("evaluateOpenPlay TARGET hit, mutate:false: full SELL card renders but signal_committed is false (the exact reported bug)", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5050 });

  const payload = await evaluateSpxPlay(desk(5060), EMPTY_TECHNICALS, { mutate: false });

  assert.equal(payload.action, "SELL");
  assert.match(payload.headline, /TARGET/);
  assert.equal(
    payload.signal_committed,
    false,
    "before the fix this was hardcoded true even though nothing was closed"
  );

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen, "read-only poll must not actually close the play, no matter what action it renders");
});

test("evaluateOpenPlay TARGET hit, mutate:true: SELL is real — signal_committed true and the play is actually closed", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5050 });

  const payload = await evaluateSpxPlay(desk(5060), EMPTY_TECHNICALS, { mutate: true });

  assert.equal(payload.action, "SELL");
  assert.equal(payload.signal_committed, true);

  const stillOpen = await loadOpenPlay();
  assert.equal(stillOpen, null, "mutate:true must actually close the play");
});
