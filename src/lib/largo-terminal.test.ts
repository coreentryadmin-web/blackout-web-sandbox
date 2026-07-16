import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeEnvelope, envelopeFromMarkdown } from "@/lib/bie/answer-envelope";

// A genuinely RICH synthesis envelope (multi-section + evidence + scenarios) — the shape the verdict
// composer produces. Must be attached to the query response as `envelope`.
const RICH_ENVELOPE = makeEnvelope({
  headline: "SPX verdict 7500: long-γ range, neutral — moderate confidence",
  bias: "neutral",
  intent: "verdict",
  sections: [
    { title: "Dealer positioning", body: "Spot 7500 · γflip 7480", bias: "neutral", provenance: { source: "Vector GEX", freshness: "live" } },
    { title: "Options flow", body: "120 prints · call-led" },
  ],
  evidence: [{ kind: "fact", text: "spot 7500 vs γflip 7480", provenance: { source: "GEX" } }],
  confidence: { level: "moderate", why: "two live surfaces" },
  scenarios: [{ kind: "bull", thesis: "holds 7480" }],
  levels: [{ label: "gamma flip", price: 7480 }],
});

// The transition SHIM composeBieAnswer wraps a plain-string leg in — one bare "Read" section, no
// evidence/levels/scenarios. Must NOT be attached (the client renders the markdown instead).
const SHIM_ENVELOPE = envelopeFromMarkdown("**Command board:** NVDA long is live at 142.5c, +50%.", {
  headline: "0DTE plays",
  intent: "zerodte_plays",
});

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
// Task #165 — when set, the mocked anthropicToolLoop below dispatches one tool (so the
// failure row's tools_used can be proven to carry whatever partial progress happened before
// the throw) and then throws this error, simulating a real tool-loop failure (timeout,
// Anthropic API error, etc.) instead of resolving with an answer.
let toolLoopError: Error | null = null;

// Task #166 — captures every appendLargoMessage() call so the router-path tests below can
// assert the fix directly: a BIE-router-composed assistant turn must now be persisted WITH a
// non-empty toolResults array (routed.context), not omitted as it was before this fix. See
// largo-store.ts's fetchRecentLargoAnswersWithResults doc comment for why that mattered — a
// router turn persisted with no tool_results was invisible to largo-verifier.ts's nightly
// numeric-grounding audit.
type AppendedCall = {
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  toolResults: unknown[] | undefined;
};
let appended: AppendedCall[] = [];

let runLargoQuery: typeof import("./largo-terminal").runLargoQuery;
let runLargoQueryStream: typeof import("./largo-terminal").runLargoQueryStream;
let isRichBieEnvelope: typeof import("./largo-terminal").isRichBieEnvelope;

// logBie() (largo-terminal.ts) fires the DB write as a detached
// `void import("./db").then((m) => m.insertBieInteraction(row))` — deliberately
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
        if (toolLoopError) {
          // Partial progress before the failure — proves the logged failure row's
          // tools_used carries whatever really happened, not an empty placeholder.
          await params.runTool("get_quote", { ticker: "NVDA" });
          toolLoopToolNames.push("get_quote");
          throw toolLoopError;
        }
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
      appendLargoMessage: async (
        _sid: string,
        _userId: string,
        role: "user" | "assistant",
        content: string,
        toolsUsed: string[] = [],
        toolResults?: unknown[]
      ) => {
        appended.push({ role, content, toolsUsed, toolResults });
      },
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
          // Carries a SHIM envelope (as production composeBieAnswer now always does for a string
          // leg) — used below to prove the API gate DROPS a non-rich envelope.
          return {
            answer: "**Command board:** NVDA long is live at 142.5c, +50%.",
            context: { live_pnl_pct: 50 },
            envelope: SHIM_ENVELOPE,
          };
        }
        if (route.intent === "market_context") {
          return {
            answer: "**Market context:** SPX grinding higher, VIX pinned low.",
            context: { vix: 12.5 },
          };
        }
        if (route.intent === "verdict") {
          // The rich synthesis path — its populated envelope MUST reach the response.
          return {
            answer: RICH_ENVELOPE.markdown,
            context: { verdict: true },
            envelope: RICH_ENVELOPE,
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
  ({ runLargoQuery, runLargoQueryStream, isRichBieEnvelope } = await import("./largo-terminal"));
});

test("runLargoQuery: a deterministic router turn persists intent_bucket = the real intent, tools_used = [blackout_intelligence]", async () => {
  inserted = [];
  appended = [];
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

  // Task #166: the router-composed assistant turn must persist its composed
  // context as tool_results — previously omitted entirely, which left this whole
  // path invisible to largo-verifier.ts's nightly grounding audit
  // (fetchRecentLargoAnswersWithResults filters WHERE tool_results IS NOT NULL).
  assert.equal(appended.length, 2, "expected one user + one assistant appendLargoMessage call");
  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.ok(assistantCall, "assistant turn was persisted");
  assert.ok(
    Array.isArray(assistantCall.toolResults) && assistantCall.toolResults.length > 0,
    "router-composed assistant turn must persist a non-empty toolResults array"
  );
  // The mocked composeBieAnswer() for "zerodte_plays" returns context: { live_pnl_pct: 50 } —
  // confirm it's exactly that payload (wrapped, not dropped or replaced) that gets persisted.
  assert.deepEqual(assistantCall.toolResults, [{ live_pnl_pct: 50 }]);
});

test("runLargoQuery: a Claude-fallback turn persists intent_bucket = 'claude_fallback' and the real dispatched tool names", async () => {
  inserted = [];
  appended = [];
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

  // Task #166 is scoped to the router path — confirm the pre-existing Claude-tool-loop
  // persistence (capturedResults, already correct before this fix) is untouched.
  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.deepEqual(assistantCall.toolResults, [{ ok: true }, { ok: true }]);
});

test("runLargoQueryStream: same persistence contract on the streaming path — router branch", async () => {
  inserted = [];
  appended = [];
  const events: unknown[] = [];
  await runLargoQueryStream("What's the market doing?", "", "user-3", (e) => events.push(e));
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "bie-router");
  assert.equal(row.intent_bucket, "market_context");
  assert.deepEqual(row.tools_used, ["blackout_intelligence"]);

  // Task #166 — same fix, streaming call site (runLargoQueryStream's own tryBieRoute
  // branch, a separate call site from runLargoQuery's above).
  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.deepEqual(assistantCall.toolResults, [{ vix: 12.5 }]);
});

test("runLargoQueryStream: same persistence contract on the streaming path — Claude-fallback branch", async () => {
  inserted = [];
  toolLoopToolNames = [];
  const events: unknown[] = [];
  // Use a question that no BIE route matches — the original "Should I hold my TSLA play"
  // now routes to ticker_advice → composer-failed fallback (the fix this PR introduces).
  await runLargoQueryStream("I lost money on my trades today", "", "user-4", (e) => events.push(e));
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  assert.equal(row.intent, null);
  assert.equal(row.intent_bucket, "claude_fallback");
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
});

// Task #165 — root cause: runLargoQuery's try block wrapping anthropicToolLoop had ONLY a
// finally, no catch, so a thrown error skipped logBie() entirely and propagated straight to
// the API route (a bare 502) with no trace in bie_interactions. These two tests lock in the
// fix: the error must still propagate/emit completely unchanged (never swallowed), AND a
// minimal failure row must land so calibration reports can see the failure happened at all.
test("runLargoQuery: a thrown tool-loop error still propagates AND writes a logBie row with answer_source 'error'", async () => {
  inserted = [];
  toolLoopToolNames = [];
  toolLoopError = new Error("tool loop boom");
  try {
    await assert.rejects(
      () => runLargoQuery("Why did NVDA reverse today?", "", "user-err-1"),
      /tool loop boom/
    );
    await waitForInserts(1);

    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    assert.equal(row.answer_source, "error");
    // Claims are explicitly null (never 0) — a turn that never produced an answer has no
    // claims that were "verified none of," which is what 0 would falsely imply.
    assert.equal(row.claims_total, null);
    assert.equal(row.claims_verified, null);
    assert.equal(row.intent, null);
    assert.equal(row.intent_bucket, "claude_fallback");
    // Whatever tool progress happened before the throw is still captured — not an empty
    // placeholder — same "real tool names dispatched this turn" contract as the success path.
    assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote"]);
    assert.equal(typeof row.latency_ms, "number");
  } finally {
    toolLoopError = null;
  }
});

test("runLargoQueryStream: a thrown tool-loop error still emits an 'error' SSE event AND writes a logBie row with answer_source 'error'", async () => {
  inserted = [];
  toolLoopToolNames = [];
  toolLoopError = new Error("stream tool loop boom");
  try {
    const events: unknown[] = [];
    // runLargoQueryStream's own catch swallows the error (it emits an SSE event instead of
    // rethrowing) — the call must resolve, not reject. Use a question that no BIE route
    // matches so we fall through to the Claude tool-loop where the toolLoopError can trigger.
    await runLargoQueryStream("I lost money on my trades today", "", "user-err-2", (e) =>
      events.push(e)
    );
    await waitForInserts(1);

    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    assert.equal(row.answer_source, "error");
    assert.equal(row.claims_total, null);
    assert.equal(row.claims_verified, null);
    assert.equal(row.intent_bucket, "claude_fallback");
    assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote"]);

    // The pre-existing error-event behavior is completely unchanged by this fix — purely
    // additive logging, never a swallow of the visible failure signal either.
    const errorEvent = events.find((e) => (e as { type?: string }).type === "error") as
      | { type: string; message: string }
      | undefined;
    assert.ok(errorEvent, "expected an 'error' SSE event");
    assert.equal(errorEvent?.message, "stream tool loop boom");
  } finally {
    toolLoopError = null;
  }
});

// ── Envelope-through-API (task #64) ─────────────────────────────────────────
// Thread the composed BieAnswerEnvelope through tryBieRoute → the query response as `envelope`, but
// ONLY when it's a genuinely rich synthesis — a trivial string leg's shim envelope is dropped so the
// client falls back to `answer` markdown. `answer`/source/tools_used stay unchanged (back-compat).

test("isRichBieEnvelope: rich synthesis → true; string-leg shim → false; nullish → false", () => {
  assert.equal(isRichBieEnvelope(RICH_ENVELOPE), true);
  assert.equal(isRichBieEnvelope(SHIM_ENVELOPE), false);
  assert.equal(isRichBieEnvelope(null), false);
  assert.equal(isRichBieEnvelope(undefined), false);
});

test("runLargoQuery: a rich verdict synthesis attaches the structured envelope to the response", async () => {
  inserted = [];
  appended = [];
  const result = await runLargoQuery("is SPX 7500 0DTE good today", "", "user-env-1");

  assert.equal(result.source, "blackout-intelligence");
  // The rich envelope is threaded through verbatim…
  assert.ok(result.envelope, "a rich verdict answer must carry an envelope");
  assert.equal(result.envelope?.headline, RICH_ENVELOPE.headline);
  assert.equal(result.envelope?.sections.length, 2);
  assert.equal(result.envelope?.scenarios?.length, 1);
  // …while `answer` (markdown) is unchanged for back-compat.
  assert.equal(result.answer, RICH_ENVELOPE.markdown);
});

test("runLargoQuery: a trivial string leg (shim envelope) does NOT attach an envelope — client uses markdown", async () => {
  inserted = [];
  appended = [];
  const result = await runLargoQuery("How are today's plays doing?", "", "user-env-2");

  assert.equal(result.source, "blackout-intelligence");
  assert.equal(result.envelope, undefined, "a shim envelope must be gated out of the response");
  // The string answer is still delivered as before.
  assert.match(result.answer, /Command board/);
});

test("runLargoQueryStream: the done event carries the rich envelope on a verdict synthesis", async () => {
  inserted = [];
  appended = [];
  const events: unknown[] = [];
  await runLargoQueryStream("is SPX 7500 0DTE good today", "", "user-env-3", (e) => events.push(e));

  const done = events.find((e) => (e as { type?: string }).type === "done") as
    | { type: string; envelope?: { headline?: string; sections?: unknown[] } }
    | undefined;
  assert.ok(done, "expected a done event");
  assert.ok(done?.envelope, "the streaming done event must carry the rich envelope");
  assert.equal(done?.envelope?.headline, RICH_ENVELOPE.headline);
});

test("runLargoQueryStream: the done event omits the envelope for a trivial string leg", async () => {
  inserted = [];
  appended = [];
  const events: unknown[] = [];
  await runLargoQueryStream("What's the market doing?", "", "user-env-4", (e) => events.push(e));

  const done = events.find((e) => (e as { type?: string }).type === "done") as
    | { type: string; envelope?: unknown }
    | undefined;
  assert.ok(done, "expected a done event");
  assert.equal(done?.envelope, undefined, "market_context has no envelope → done event omits it");
});

test("runLargoQuery: routed-but-null-composed returns honest fallback, never falls through to Claude (SPY/QQQ misroute regression)", async () => {
  inserted = [];
  appended = [];
  // "Vector setup on SPY" routes to vector_read with ticker=SPY, but the mock
  // composeBieAnswer returns null for vector_read (simulating the composer
  // throwing internally). Before the fix, this would fall through to the Claude
  // tool-loop which only has SPX context, silently answering SPY with SPX data.
  const result = await runLargoQuery("Vector setup on SPY", "", "user-misroute-1");
  await waitForInserts(1);

  assert.equal(result.source, "blackout-intelligence", "must NOT fall through to Claude");
  assert.match(result.answer, /vector read/i, "honest fallback mentions the matched intent");
  assert.match(result.answer, /SPY/i, "honest fallback names the requested ticker");
  assert.match(result.answer, /couldn't compose/i, "honest fallback explains the gap");

  const row = inserted[0]!;
  assert.equal(row.answer_source, "bie-router", "logged as router path, not claude");
  assert.equal(row.intent, "vector_read");
});
