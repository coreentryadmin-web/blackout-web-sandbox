import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayPayload } from "@/lib/spx-play-payload";
import type { SpxSignalLogRow } from "@/lib/providers/spx-signal-log";

// mock.module() must be registered before admin-spx-health.ts (and therefore
// its dependency imports: spx-desk-loader, spx-evaluator, spx-play-technicals,
// flow-liveness, providers/spx-signal-log) is ever loaded — same ordering
// requirement as spx-signals-shadow-ecosystem.test.ts's own header comment (ES
// module imports are hoisted ahead of any other module-body code, including a
// mock.module() call written textually above them). So the module under test
// is loaded dynamically inside before(), same pattern as that file.
//
// Only the exact named exports admin-spx-health.ts actually imports from each
// module are mocked — spx-desk-stale.ts and spx-play-config.ts are left real
// (pure, no I/O) so the staleness math under test is the real production math,
// not a re-implemented stand-in.

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  // as_of/polled_at default to "now" (not a fixed historical timestamp) so the
  // happy-path tests are never accidentally "stale" depending on wall-clock
  // time when the suite runs — the dedicated staleness test below overrides
  // these explicitly with an old timestamp.
  const now = new Date().toISOString();
  return {
    available: true,
    as_of: now,
    source: "test",
    price: 5555,
    spx_change_pct: 0.1,
    polled_at: now,
    market_open: true,
    ...overrides,
  } as SpxDeskPayload;
}

function playStub(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    phase: "WATCHING",
    action: "WATCHING",
    direction: "long",
    grade: "B",
    score: 62,
    confidence: 55,
    headline: "test headline",
    thesis: "test thesis",
    idle_message: null,
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: { passed: false, blocks: ["Buy cooldown"], warnings: [], entry_mode: "watch", play_idea: null },
    claude: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    as_of: "2026-07-04T14:30:05.000Z",
    ...overrides,
  };
}

function signalRow(overrides: Partial<SpxSignalLogRow> = {}): SpxSignalLogRow {
  return {
    id: 1,
    signal_key: "2026-07-04|BUY|long",
    action: "BUY",
    bias: "bullish",
    score: 78,
    confidence: 66,
    price: 5550,
    entry: 5550,
    stop: 5530,
    target: 5590,
    headline: "SPX BUY long",
    factors: [],
    created_at: "2026-07-04T14:25:00.000Z",
    ...overrides,
  };
}

let deskImpl: () => Promise<{ merged: SpxDeskPayload }> = async () => ({ merged: deskStub() });
let playImpl: () => Promise<SpxPlayPayload> = async () => playStub();
let technicalsImpl: () => Promise<unknown> = async () => ({ available: true });
let flowLiveImpl: () => Promise<boolean> = async () => true;
let signalsImpl: () => Promise<SpxSignalLogRow[]> = async () => [signalRow()];
let playCalls: Array<{ desk: unknown; technicals: unknown }> = [];

mock.module("./spx-desk-loader", {
  namedExports: {
    loadMergedSpxDesk: async () => deskImpl(),
  },
});
mock.module("./spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async (desk: unknown, technicals: unknown) => {
      playCalls.push({ desk, technicals });
      return playImpl();
    },
  },
});
mock.module("./spx-play-technicals", {
  namedExports: {
    buildPlayTechnicals: async () => technicalsImpl(),
  },
});
mock.module("./flow-liveness", {
  namedExports: {
    isFlowFrameFreshAnywhere: async () => flowLiveImpl(),
  },
});
mock.module("./providers/spx-signal-log", {
  namedExports: {
    fetchRecentSpxSignals: async () => signalsImpl(),
  },
});

let fetchSpxHealthSnapshot: typeof import("./admin-spx-health").fetchSpxHealthSnapshot;

before(async () => {
  ({ fetchSpxHealthSnapshot } = await import("./admin-spx-health"));
});

function resetMocks() {
  deskImpl = async () => ({ merged: deskStub() });
  playImpl = async () => playStub();
  technicalsImpl = async () => ({ available: true });
  flowLiveImpl = async () => true;
  signalsImpl = async () => [signalRow()];
  playCalls = [];
}

test("fetchSpxHealthSnapshot: happy path wires desk/play/signals straight through, no errors", async () => {
  resetMocks();

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.play?.phase, "WATCHING");
  assert.equal(snap.play?.action, "WATCHING");
  assert.equal(snap.play?.gates.passed, false);
  assert.deepEqual(snap.play?.gates.blocks, ["Buy cooldown"]);
  assert.equal(snap.desk.available, true);
  assert.equal(snap.desk.market_open, true);
  assert.equal(snap.desk.price, 5555);
  assert.equal(snap.desk.stale, false);
  assert.equal(snap.flow_feed_live, true);
  assert.equal(snap.recent_signals.length, 1);
  assert.equal(snap.recent_signals[0].action, "BUY");
  assert.equal(snap.recent_signals[0].headline, "SPX BUY long");
  assert.deepEqual(snap.errors, []);
});

test("fetchSpxHealthSnapshot: desk older than the play engine's own GEX-stale threshold reports desk.stale true", async () => {
  resetMocks();
  const oldTs = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min old; default threshold is 90s
  deskImpl = async () => ({ merged: deskStub({ polled_at: oldTs, as_of: oldTs }) });

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.desk.stale, true);
  assert.equal(snap.desk.stale_threshold_sec, 90);
  assert.ok(snap.desk.age_sec != null && snap.desk.age_sec > 90);
});

test("fetchSpxHealthSnapshot: desk build failure degrades desk+play together and never throws", async () => {
  resetMocks();
  deskImpl = async () => {
    throw new Error("desk boom");
  };

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.play, null);
  assert.equal(snap.desk.available, false);
  assert.equal(snap.desk.price, null);
  assert.equal(snap.desk.market_open, false);
  assert.ok(snap.errors.some((e) => e.includes("desk/play") && e.includes("desk boom")));
});

test("fetchSpxHealthSnapshot: play-evaluation failure still surfaces real desk info (partial degrade, not both blanked)", async () => {
  resetMocks();
  deskImpl = async () => ({ merged: deskStub({ price: 5601 }) });
  playImpl = async () => {
    throw new Error("evaluate boom");
  };

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.play, null);
  assert.equal(snap.desk.available, true);
  assert.equal(snap.desk.price, 5601);
  assert.ok(snap.errors.some((e) => e.includes("desk/play") && e.includes("evaluate boom")));
});

test("fetchSpxHealthSnapshot: flow-feed probe failure reports flow_feed_live:false + a logged error, not a thrown exception", async () => {
  resetMocks();
  flowLiveImpl = async () => {
    throw new Error("redis down");
  };

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.flow_feed_live, false);
  assert.ok(snap.errors.some((e) => e.includes("flow feed probe") && e.includes("redis down")));
});

test("fetchSpxHealthSnapshot: signal-log failure returns an empty list, not a thrown exception", async () => {
  resetMocks();
  signalsImpl = async () => {
    throw new Error("db down");
  };

  const snap = await fetchSpxHealthSnapshot();

  assert.deepEqual(snap.recent_signals, []);
  assert.ok(snap.errors.some((e) => e.includes("signal log") && e.includes("db down")));
});

test("fetchSpxHealthSnapshot: technicals build failure is logged but still yields a play snapshot (technicals passed through as null)", async () => {
  resetMocks();
  technicalsImpl = async () => {
    throw new Error("technicals boom");
  };
  playImpl = async () => playStub({ phase: "SCANNING", action: "SCANNING" });

  const snap = await fetchSpxHealthSnapshot();

  assert.equal(snap.play?.phase, "SCANNING");
  assert.ok(snap.errors.some((e) => e.includes("technicals") && e.includes("technicals boom")));
  assert.equal(playCalls.at(-1)?.technicals, null);
});
