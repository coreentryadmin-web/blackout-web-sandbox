import assert from "node:assert/strict";
import { before, describe, test, mock } from "node:test";

// Regression: fetchRecentLargoAnswersWithResults() is the new cron-readable, cross-user reader
// that closes largo-verifier.ts's coverage gap (previously no way to enumerate real Largo
// answers with their tool_results outside a single session+user). Verify it filters to
// assistant rows with non-null tool_results, and correctly rejects null/missing rows.

let capturedSql = "";
let capturedParams: unknown[] = [];
let mockRows: Array<{ id: number; content: string; tool_results: unknown; created_at: Date }> = [];

// Task #166 — dbClient is normally forbidden here (see the throwing default below, which pins
// the invariant that fetchRecentLargoAnswersWithResults is a pure dbQuery read with zero
// transaction use). appendLargoMessage() DOES need a real client (it writes inside a
// BEGIN/COMMIT transaction) — the "appendLargoMessage persists tool_results" suite further down
// flips allowDbClient on for just its own tests and captures every query the transaction runs,
// then flips it back off so it can't accidentally mask a regression in the read-only suite above.
let allowDbClient = false;
let dbClientQueries: Array<{ sql: string; params: unknown[] }> = [];

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (sql: string, params: unknown[]) => {
      // ensureLargoSession's upsert (appendLargoMessage's first step) also goes through
      // dbQuery, not dbClient — it shares this same mock, so it needs its own branch:
      // echo the passed-in userId back as the "existing owner" so appendLargoMessage's
      // ownership assertion (`upserted.rows[0]?.user_id !== userId`) always passes.
      if (/INSERT INTO largo_sessions/.test(sql)) {
        return { rows: [{ user_id: params[1] }], rowCount: 1 };
      }
      capturedSql = sql;
      capturedParams = params;
      return { rows: mockRows, rowCount: mockRows.length };
    },
    dbClient: async () => {
      if (!allowDbClient) {
        throw new Error("dbClient should not be called by fetchRecentLargoAnswersWithResults");
      }
      return {
        query: async (sql: string, params: unknown[] = []) => {
          dbClientQueries.push({ sql, params });
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      };
    },
  },
});

describe("largo-store: fetchRecentLargoAnswersWithResults", () => {
  let fetchRecentLargoAnswersWithResults: typeof import("./largo-store").fetchRecentLargoAnswersWithResults;

  before(async () => {
    ({ fetchRecentLargoAnswersWithResults } = await import("./largo-store"));
  });

  test("queries only assistant rows with non-null tool_results", async () => {
    mockRows = [];
    await fetchRecentLargoAnswersWithResults(25);
    assert.match(capturedSql, /role = 'assistant'/);
    assert.match(capturedSql, /tool_results IS NOT NULL/);
    assert.deepEqual(capturedParams, [25]);
  });

  test("maps rows into the RecentLargoAnswer shape, defaulting non-array tool_results to []", async () => {
    const createdAt = new Date("2026-07-04T12:00:00.000Z");
    mockRows = [
      { id: 7, content: "SPX at 5900.", tool_results: [{ spot: 5900 }], created_at: createdAt },
      { id: 8, content: "Fallback row.", tool_results: null, created_at: createdAt },
    ];
    const rows = await fetchRecentLargoAnswersWithResults(25);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].tool_results, [{ spot: 5900 }]);
    assert.deepEqual(rows[1].tool_results, []);
    assert.equal(rows[0].created_at, createdAt.toISOString());
  });

  test("defaults to limit 50 when called with no argument", async () => {
    mockRows = [];
    await fetchRecentLargoAnswersWithResults();
    assert.deepEqual(capturedParams, [50]);
  });
});

// Task #166 — the actual bug: largo-terminal.ts's two BIE-router call sites used to call
// appendLargoMessage() WITHOUT a toolResults argument at all for router-composed answers, so
// every router turn persisted tool_results = NULL and was silently excluded from
// fetchRecentLargoAnswersWithResults above (WHERE tool_results IS NOT NULL) — the nightly
// largo-verifier.ts audit had zero coverage of the router/composer path. The fix (largo-terminal.ts)
// now passes `[routed.context]` — the composer's own source payload, wrapped in a single-element
// array to match the tool_results column's "array of results" shape. These tests exercise
// appendLargoMessage() directly (the actual INSERT), proving: (1) that shape serializes to a
// non-null JSON value, closing the loop with the read-side tests above, and (2) the pre-fix
// call shape (toolResults omitted) still persists NULL — i.e. this is a caller-side fix, not a
// column-semantics change.
describe("largo-store: appendLargoMessage persists router-composed tool_results (task #166)", () => {
  let appendLargoMessage: typeof import("./largo-store").appendLargoMessage;

  before(async () => {
    ({ appendLargoMessage } = await import("./largo-store"));
  });

  test("a router-composed assistant turn ([routed.context]) INSERTs with non-null tool_results", async () => {
    allowDbClient = true;
    dbClientQueries = [];
    try {
      await appendLargoMessage(
        "session-166",
        "user-166",
        "assistant",
        "**Market context:** SPX grinding higher, VIX pinned low.",
        ["blackout_intelligence"],
        [{ vix: 12.5, spx: 5900 }]
      );
    } finally {
      allowDbClient = false;
    }

    const insertCall = dbClientQueries.find((q) => /INSERT INTO largo_messages/.test(q.sql));
    assert.ok(insertCall, "expected an INSERT INTO largo_messages call");
    // tool_results is the 5th bind param ($5::jsonb) — must be a real JSON value, never the
    // literal NULL a router turn produced before this fix (largo-terminal.ts previously called
    // appendLargoMessage() for router turns with no toolResults argument at all).
    const toolResultsParam = insertCall!.params[4];
    assert.notEqual(toolResultsParam, null, "router-composed tool_results must not be NULL");
    assert.deepEqual(JSON.parse(toolResultsParam as string), [{ vix: 12.5, spx: 5900 }]);
  });

  test("an omitted toolResults argument (the pre-fix router call shape) still persists NULL", async () => {
    allowDbClient = true;
    dbClientQueries = [];
    try {
      await appendLargoMessage("session-166b", "user-166", "assistant", "Some answer.", ["blackout_intelligence"]);
    } finally {
      allowDbClient = false;
    }
    const insertCall = dbClientQueries.find((q) => /INSERT INTO largo_messages/.test(q.sql));
    assert.ok(insertCall, "expected an INSERT INTO largo_messages call");
    assert.equal(insertCall!.params[4], null);
  });
});
