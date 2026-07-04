import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// Task #103 — persist tools_used + intent_bucket into bie_interactions so #112's
// self-eval loop can eventually know what ACTUALLY happened on a Largo turn (which
// tools ran, and whether the router answered deterministically or fell through to
// Claude). This file drives runLargoQuery/runLargoQueryStream end-to-end (mocking
// only the provider/DB boundary) for both branches and asserts on the exact row
// handed to insertBieInteraction.

// Hermetic fixture — makes dbConfigured() true so logBie() actually attempts the
// (mocked) insertBieInteraction call, mirroring run-tool.test.ts's own pattern.
// No real Postgres connection is ever attempted: every db.ts-touching module on
// this code path is mocked below.
process.env.DATABASE_URL = "postgres://test-hermetic-fixture";
// anthropicConfigured() must read true for runLargoQuery/Stream to proceed past
// their opening guard — anthropicToolLoop/anthropicText are mocked below and never
// make a real request, so this key is never actually used.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-hermetic-fixture";

type InsertedRow = {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  tools_used: string[];
  intent_bucket: string;
};

let inserted: InsertedRow[] = [];
let toolLoopToolNames: string[] = [];

let runLargoQuery: typeof import("./largo-terminal").runLargoQuery;
let runLargoQueryStream: typeof import("./largo-terminal").runLargoQueryStream;

// logBie() (largo-terminal.ts) fires the DB write as a detached
// `void import("@/lib/db").then((m) => m.insertBieInteraction(row))` — deliberately
// never awaited by its caller, so a slow/failed write can never delay or break the
// member-visible answer. That means runLargoQuery/Stream's own returned promise
// resolves before the detached write necessarily has landed. Poll instead of a
// fixed number of microtask/macrotask flushes — empirically the dynamic import
// takes a variable number of ticks to settle, and a single setImmediate proved
// flaky (a prior test's insert would land mid-way through the NEXT test).
async function waitForInserts(count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (inserted.length < count) {
    if (Date.now() - start > timeoutMs) return; // let the assertion below fail with a clear diff
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

before(async () => {
  // namedExports fully REPLACES a module's exports (see run-tool.test.ts's note) —
  // spread the real db.ts module and override only insertBieInteraction, so every
  // other real db.ts function stays intact for anything that imports "@/lib/db"
  // (module identity is by resolved file path, so this applies process-wide).
  const realDb = await import("./db");
  mock.module("./db", {
    namedExports: {
      ...realDb,
      insertBieInteraction: async (row: InsertedRow) => {
        inserted.push(row);
      },
    },
  });

  mock.module("./providers/anthropic", {
    namedExports: {
      anthropicConfigured: () => true,
      anthropicText: async () => "",
      // Simulates a real Largo turn: the model calls two tools, then answers.
      anthropicToolLoop: async (params: {
        runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
      }) => {
        await params.runTool("get_quote", { ticker: "NVDA" });
        await params.runTool("get_technicals", { ticker: "NVDA" });
        toolLoopToolNames.push("get_quote", "get_technicals");
        return "NVDA is holding above VWAP. **Bottom line:** momentum favors calls.";
      },
      LARGO_MODEL: "claude-test-model",
      COMMENTARY_MODEL: "claude-test-fast-model",
    },
  });

  // The real run-tool.ts pulls in nearly every provider client (Polygon/UW/
  // Benzinga/etc.) — irrelevant to this file's concern (does the DISPATCHED tool
  // list reach bie_interactions), so it's stubbed wholesale, same rationale
  // run-tool.test.ts documents for mocking "server-only"'s transitive pull-in.
  mock.module("./largo/run-tool", {
    namedExports: {
      runLargoTool: async () => ({ ok: true }),
    },
  });

  // spx-desk-cache.ts transitively imports providers/spx-desk.ts, which has
  // `import "server-only"` somewhere in ITS graph — same category of problem
  // run-tool.test.ts documents for get_positioning's gex-positioning.ts pull-in.
  // resetLargoSpxDeskCache is a one-line in-memory Map.delete(); stubbing it
  // avoids loading that whole chain under plain `node --test` (no Next.js
  // "react-server" condition to satisfy server-only's export map).
  mock.module("./largo/spx-desk-cache", {
    namedExports: {
      resetLargoSpxDeskCache: () => {},
    },
  });

  mock.module("./largo/largo-store", {
    namedExports: {
      ensureLargoSession: async () => {},
      fetchLargoHistory: async () => [],
      fetchLargoMessagesPublic: async () => [],
      sessionOwnedByUser: async () => true,
      appendLargoMessage: async () => {},
    },
  });

  // Real captureLargoLiveFeed reaches live Polygon/UW providers — replaced with a
  // fixed minimal feed so the Claude-fallback branch never attempts network I/O.
  mock.module("./largo/largo-live-feed", {
    namedExports: {
      captureLargoLiveFeed: async () => ({}),
      formatLargoLiveFeed: () => "live feed placeholder",
    },
  });

  // classifyBieIntent/bieIntentBucket are deliberately left REAL (unmocked) —
  // this suite exists to prove the real router decision reaches the persisted
  // row, not a stand-in for it.
  mock.module("./bie/composers", {
    namedExports: {
      // Only "zerodte_plays"/"market_context" compose here (the two intents this
      // suite's router-path tests actually drive) — any other intent falls
      // through to Claude the same way an unmatched question would, which is
      // enough to exercise both logBie branches without wiring up every composer.
      composeBieAnswer: async (route: { intent: string }) => {
        if (route.intent === "zerodte_plays") {
          return {
            answer: "**Command board:** NVDA long is live at 142.5c, +50%.",
            context: { live_pnl_pct: 50 },
          };
        }
        if (route.intent === "market_context") {
          return {
            answer: "**Market context:** SPX grinding higher, VIX pinned low.",
            context: { vix: 12.5 },
          };
        }
        return null;
      },
    },
  });

  mock.module("./zerodte/scan", {
    namedExports: {
      readZeroDteLedger: async () => [],
    },
  });

  mock.module("./bie/knowledge", {
    namedExports: {
      searchKnowledge: async () => [],
    },
  });

  // Imported dynamically, AFTER every mock above is registered — a static
  // top-level import would be hoisted ahead of this before() hook and load the
  // real modules first (same ordering requirement run-tool.test.ts documents).
  ({ runLargoQuery, runLargoQueryStream } = await import("./largo-terminal"));
});

test("runLargoQuery: a deterministic router turn persists intent_bucket = the real intent, tools_used = [blackout_intelligence]", async () => {
  inserted = [];
  const result = await runLargoQuery("How are today's plays doing?", "", "user-1");
  await waitForInserts(1);

  assert.equal(result.source, "blackout-intelligence");
  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "bie-router");
  assert.equal(row.intent, "zerodte_plays");
  // The whole point of task #103: intent_bucket carries the real routed intent
  // name (not null) whenever the router actually matched.
  assert.equal(row.intent_bucket, "zerodte_plays");
  assert.deepEqual(row.tools_used, ["blackout_intelligence"]);
});

test("runLargoQuery: a Claude-fallback turn persists intent_bucket = 'claude_fallback' and the real dispatched tool names", async () => {
  inserted = [];
  toolLoopToolNames = [];
  // "Why did NVDA reverse?" fails classifyBieIntent's REASONING_RE guard ("why")
  // — falls through to Claude, exactly like a real unmatched member question.
  const result = await runLargoQuery("Why did NVDA reverse today?", "", "user-2");
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  // The pre-existing `intent` column keeps its original null-on-fallback meaning
  // (untouched, purely additive change) —
  assert.equal(row.intent, null);
  // — while the new intent_bucket column gives fallback turns an explicit,
  // queryable sentinel instead of a bare NULL.
  assert.equal(row.intent_bucket, "claude_fallback");
  // The actual tool names dispatched this turn, deduped — "live_feed_capture" is
  // seeded into every Claude-path turn by prepareLargoTurn() before the model
  // calls anything (largo-terminal.ts's toolsUsed seed), plus the two tools the
  // mocked tool loop actually invoked. Not an empty array, not a placeholder.
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
  assert.equal(result.source, "blackout-web+postgres");
});

test("runLargoQueryStream: same persistence contract on the streaming path — router branch", async () => {
  inserted = [];
  const events: unknown[] = [];
  await runLargoQueryStream("What's the market doing?", "", "user-3", (e) => events.push(e));
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "bie-router");
  assert.equal(row.intent_bucket, "market_context");
  assert.deepEqual(row.tools_used, ["blackout_intelligence"]);
});

test("runLargoQueryStream: same persistence contract on the streaming path — Claude-fallback branch", async () => {
  inserted = [];
  toolLoopToolNames = [];
  const events: unknown[] = [];
  await runLargoQueryStream("Should I hold my TSLA play into the close?", "", "user-4", (e) => events.push(e));
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  assert.equal(row.intent, null);
  assert.equal(row.intent_bucket, "claude_fallback");
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
});
