import assert from "node:assert/strict";
import { before, beforeEach, describe, test, mock } from "node:test";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

// Regression: generateSpxCommentary()'s post-generation grounding-guard failure path
// (spx-commentary.ts ~line 597) used to `return null` on a hallucinated Live Desk AI read
// with nothing durable recorded — just an ephemeral console.warn, discarded before the
// caller's 502. The sibling AI-narration surface, spx-play-claude.ts's logPlayVerdict(), has
// written EVERY verdict (pass or fail) to the shared alert_audit_log table since it shipped,
// so there was no way to answer "how often does the dashboard's Live Desk AI rail silently
// throw away a hallucinated read." This test forces the grounding check to fail
// deterministically and asserts the new audit-log write is attempted with the right shape.
//
// mock.module() idiom follows src/lib/nighthawk/play-critic.test.ts and
// src/app/api/platform/intel/route.test.ts: bare specifiers resolve relative to THIS file,
// not through the "@/" tsconfig alias spx-commentary.ts itself uses, and each mocked module
// is set up once at import time (ESM caches on first import) with mutable state read at
// call time.

let mockRaw: string | null = null;
let mockGrounded = true;
let mockUngroundedValue: number | null = null;

mock.module("./anthropic", {
  namedExports: {
    anthropicText: async () => mockRaw,
    COMMENTARY_MODEL: "claude-haiku-mock",
  },
});

mock.module("../grounding-guard", {
  namedExports: {
    augmentKnownCommentaryNumbers: (known: number[]) => known,
    knownCommentaryNumbers: () => [],
    collectKnownNumbers: () => [],
    extractNumbersFromText: () => [],
    checkCommentaryGrounded: () => ({ grounded: mockGrounded, ungroundedValue: mockUngroundedValue }),
  },
});

type AuditLogRow = {
  alert_type: string;
  source_table: string;
  source_key: Record<string, unknown>;
  ticker: string;
  direction: string | null;
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string | null;
  decision_trace: unknown;
  input_snapshot: Record<string, unknown> | null;
  final_output: Record<string, unknown> | null;
};

let auditLogCalls: AuditLogRow[] = [];
let dbIsConfigured = true;

mock.module("../db", {
  namedExports: {
    dbConfigured: () => dbIsConfigured,
    insertAlertAuditLog: async (row: AuditLogRow) => {
      auditLogCalls.push(row);
    },
  },
});

function fakeDesk(): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-04T15:00:00.000Z",
    source: "test",
    price: 5900,
    vwap: 5895,
    gamma_flip: 5890,
    gex_king: 5900,
    max_pain: 5850,
    gex_walls: [],
    levels: [],
  } as unknown as SpxDeskPayload;
}

describe("spx-commentary: grounding-failure audit trail", () => {
  let generateSpxCommentary: typeof import("../../features/spx/lib/spx-commentary").generateSpxCommentary;

  before(async () => {
    ({ generateSpxCommentary } = await import("../../features/spx/lib/spx-commentary"));
  });

  beforeEach(() => {
    auditLogCalls = [];
    dbIsConfigured = true;
    mockGrounded = true;
    mockUngroundedValue = null;
    mockRaw = JSON.stringify({
      headline: "LONG A · {{5900}} holding above VWAP",
      bias: "bullish",
      body: "WHY  dealers buy dips above γflip.\nLEVELS  R {{5950}}\nSETUP  long\nRISK  half size\nNEXT 5M  grind up\nFLIPS IT  lose {{5890}}",
      watch: [],
      changed: [],
    });
  });

  test("a hallucinated read is discarded (null) AND fires an audit-log write with alert_type spx_commentary_ungrounded", async () => {
    mockGrounded = false;
    mockUngroundedValue = 9999;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.equal(result, null, "caller's 502-on-null contract must be unchanged");
    assert.equal(auditLogCalls.length, 1, "exactly one audit row should be attempted");

    const row = auditLogCalls[0];
    assert.equal(row.alert_type, "spx_commentary_ungrounded");
    assert.equal(row.source_table, "spx_commentary");
    assert.equal(row.ticker, "SPX");
    assert.equal(row.direction, "bullish");
    assert.match(row.trigger_reason ?? "", /9999/);
    assert.deepEqual(row.decision_trace, [
      { check: "numbers_grounded", passed: false, value: 9999 },
    ]);
    // The raw generated text before discard must be preserved — it's never served anywhere
    // else once grounding fails.
    assert.match((row.final_output?.headline as string) ?? "", /LONG A/);
    assert.match((row.final_output?.body as string) ?? "", /WHY/);
    assert.equal(row.source_key.price, 5900);
  });

  test("a grounded read passes through untouched and never touches the audit log", async () => {
    mockGrounded = true;
    mockUngroundedValue = null;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.notEqual(result, null);
    assert.equal(result?.headline, "LONG A · {{5900}} holding above VWAP");
    assert.equal(auditLogCalls.length, 0, "success path must not write to alert_audit_log");
  });

  test("the audit-log write is skipped (but the null return is unchanged) when the DB isn't configured", async () => {
    dbIsConfigured = false;
    mockGrounded = false;
    mockUngroundedValue = 9999;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.equal(result, null);
    assert.equal(auditLogCalls.length, 0, "no DB configured means no write attempt at all");
  });

  test("JSON parse failure returns null (never serves ungrounded raw text)", async () => {
    mockRaw = "This is not JSON — just prose from the model.";
    mockGrounded = true;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.equal(result, null);
    assert.equal(auditLogCalls.length, 0);
  });
});
