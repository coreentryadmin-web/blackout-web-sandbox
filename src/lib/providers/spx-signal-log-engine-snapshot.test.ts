import { test, mock } from "node:test";
import assert from "node:assert/strict";

// spx-signal-log.ts (the module under test) statically imports the ecosystem
// shadow factor chain, whose fetchEcosystemContext -> getSpxPlayState chain
// (bie/ecosystem-context.ts -> platform/spx-service.ts -> spx-play-engine.ts)
// pulls in a real `import "server-only"` several hops deep. Stub it the same
// way run-tool.test.ts (and every other spx-signal-log-*.test.ts sibling)
// does, or a plain `node --test` load crashes at import time — this file
// never exercises that chain directly, only maybeLogSpxEngineSnapshot /
// fetchRecentSpxSnapshots (task #108).
mock.module("server-only", { namedExports: {} });

// maybeLogSpxEngineSnapshot (this file's module under test) is task #108's
// retrospective engine-state snapshot logger, the sibling of maybeLogSpxPlay
// covered by spx-signal-log-precedents.test.ts's neighbors — it captures
// EVERY evaluateSpxPlay tick's phase/action/gates.blocks/direction (not just
// a committed BUY/SELL/TRIM signal) via the SAME platform_meta getMeta/
// setMeta cursor-throttle idiom maybeLogSpxPlay uses for its own signal_key.
// A single in-memory string stands in for platform_meta's one row for this
// throttle key ("spx_engine_snapshot_cursor").
const state = {
  dbConfigured: true,
  cursor: null as string | null,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.cursor = null;
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async () => ({ rows: [], rowCount: 0 }),
    getMeta: async (key: string) => (key === "spx_engine_snapshot_cursor" ? state.cursor : null),
    setMeta: async (key: string, value: string) => {
      if (key === "spx_engine_snapshot_cursor") state.cursor = value;
    },
    insertSpxSignalLog: async () => {},
    insertShadowFactorObservation: async () => {},
    insertSpxEngineSnapshot: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
    // Newest-first, mirroring db.ts's real `ORDER BY observed_at DESC` — the in-memory
    // `inserted` array is append-order (oldest first), so this reverses it.
    fetchRecentSpxEngineSnapshots: async (limit: number) =>
      state.inserted
        .slice()
        .reverse()
        .slice(0, limit)
        .map((row, i) => ({ id: state.inserted.length - i, observed_at: "2026-07-04T14:00:00.000Z", ...row })),
  },
});
mock.module("../flow-liveness", {
  namedExports: { isFlowFrameFreshAnywhere: async () => true },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-04" },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve — same idiom every spx-signal-log-*.test.ts sibling uses.
const mod = () => import("./spx-signal-log");

type SnapInput = {
  phase: string;
  action: string;
  direction: string | null;
  score: number;
  thesis: string;
  headline: string;
  gates: { passed: boolean; blocks: string[] };
  as_of: string | null;
};

function snap(overrides: Partial<SnapInput> = {}): SnapInput {
  return {
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    score: 12,
    thesis: "Below full min score threshold.",
    headline: "Scanning all lanes",
    gates: { passed: false, blocks: ["Grade below B", "Below full min score"] },
    as_of: "2026-07-04T14:00:00.000Z",
    ...overrides,
  };
}

test("maybeLogSpxEngineSnapshot: db not configured — never reads/writes platform_meta, zero inserts", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();
  state.dbConfigured = false;

  await maybeLogSpxEngineSnapshot(snap());

  assert.equal(state.inserted.length, 0);
  assert.equal(state.cursor, null);
});

test("maybeLogSpxEngineSnapshot: first tick for a new state — inserts a row with the right shape and sets the cursor", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap());

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.session_date, "2026-07-04");
  assert.equal(row.phase, "SCANNING");
  assert.equal(row.action, "SCANNING");
  assert.equal(row.direction, null);
  assert.equal(row.score, 12);
  assert.equal(row.gates_passed, false);
  assert.deepEqual(row.gates_blocks, ["Grade below B", "Below full min score"]);
  assert.equal(row.thesis, "Below full min score threshold.");
  assert.equal(row.as_of, "2026-07-04T14:00:00.000Z");
  assert.ok(state.cursor);
});

test("maybeLogSpxEngineSnapshot: unchanged phase/action/direction/gates.blocks on the next tick — throttled, no duplicate write even though score/thesis/headline jitter", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap());
  await maybeLogSpxEngineSnapshot(
    snap({ score: 13, thesis: "A slightly different thesis string", headline: "A different headline" })
  );

  assert.equal(state.inserted.length, 1, "second identical-state tick must not write a second row");
});

test("maybeLogSpxEngineSnapshot: gates.blocks changes — a new row is written (real state transition)", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap());
  await maybeLogSpxEngineSnapshot(snap({ gates: { passed: false, blocks: ["Claude veto: chop"] } }));

  assert.equal(state.inserted.length, 2);
  assert.deepEqual(state.inserted[1].gates_blocks, ["Claude veto: chop"]);
});

test("maybeLogSpxEngineSnapshot: direction flip with identical phase/action/blocks still counts as a transition", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(
    snap({ phase: "WATCHING", action: "WATCHING", direction: "long", gates: { passed: false, blocks: [] } })
  );
  await maybeLogSpxEngineSnapshot(
    snap({ phase: "WATCHING", action: "WATCHING", direction: "short", gates: { passed: false, blocks: [] } })
  );

  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[0].direction, "long");
  assert.equal(state.inserted[1].direction, "short");
});

test("maybeLogSpxEngineSnapshot: after a transition, the SAME new state throttles again (cursor rolled forward, not reset)", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap());
  await maybeLogSpxEngineSnapshot(snap({ gates: { passed: false, blocks: ["Claude veto: chop"] } }));
  await maybeLogSpxEngineSnapshot(snap({ gates: { passed: false, blocks: ["Claude veto: chop"] } }));

  assert.equal(state.inserted.length, 2, "repeating the just-transitioned-to state must not write a third row");
});

test("maybeLogSpxEngineSnapshot: empty thesis string falls back to headline", async () => {
  const { maybeLogSpxEngineSnapshot } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap({ thesis: "", headline: "Session closed" }));

  assert.equal(state.inserted[0].thesis, "Session closed");
});

test("fetchRecentSpxSnapshots: db not configured — returns [] without calling the DB layer", async () => {
  const { fetchRecentSpxSnapshots } = await mod();
  resetState();
  state.dbConfigured = false;

  const rows = await fetchRecentSpxSnapshots(10);
  assert.deepEqual(rows, []);
});

test("fetchRecentSpxSnapshots: delegates to fetchRecentSpxEngineSnapshots, newest-first", async () => {
  const { maybeLogSpxEngineSnapshot, fetchRecentSpxSnapshots } = await mod();
  resetState();

  await maybeLogSpxEngineSnapshot(snap());
  await maybeLogSpxEngineSnapshot(snap({ gates: { passed: false, blocks: ["Claude veto: chop"] } }));

  const rows = await fetchRecentSpxSnapshots(10);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].gates_blocks, ["Claude veto: chop"]);
  assert.deepEqual(rows[1].gates_blocks, ["Grade below B", "Below full min score"]);
});
