import assert from "node:assert/strict";
import { before, beforeEach, describe, test, mock } from "node:test";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

let mockBrief: {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
} | null = null;
let mockGrounded = true;
let mockUngroundedValue: number | null = null;

mock.module("../../../lib/bie/spx-desk-brief", {
  namedExports: {
    composeSpxDeskBrief: () => mockBrief,
  },
});

mock.module("../../../lib/bie/load-spx-brief-intel", {
  namedExports: {
    loadSpxBriefIntel: async () => ({ positioning: null, intelLines: [] }),
  },
});

mock.module("../../../lib/bie/embeddings", {
  namedExports: {
    bieEmbeddingsConfigured: () => false,
  },
});

mock.module("../../../lib/grounding-guard", {
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

mock.module("../../../lib/db", {
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

describe("spx-commentary: BIE brief + grounding audit trail", () => {
  let generateSpxCommentary: typeof import("./spx-commentary").generateSpxCommentary;

  before(async () => {
    ({ generateSpxCommentary } = await import("./spx-commentary"));
  });

  beforeEach(() => {
    auditLogCalls = [];
    dbIsConfigured = true;
    mockGrounded = true;
    mockUngroundedValue = null;
    mockBrief = {
      headline: "LONG {{5900}} above VWAP",
      bias: "bullish",
      body: "WHY  VWAP + γflip align.\nLEVELS  R {{5910}}\nSETUP  long\nRISK  half size\nNEXT 5M  grind\nFLIPS IT  lose {{5890}}",
      watch: [],
      changed: [],
      as_of: new Date().toISOString(),
    };
  });

  test("ungrounded BIE brief is discarded and audit-logged", async () => {
    mockGrounded = false;
    mockUngroundedValue = 9999;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.equal(result, null);
    assert.equal(auditLogCalls.length, 1);
    assert.equal(auditLogCalls[0].alert_type, "spx_commentary_ungrounded");
  });

  test("grounded BIE brief passes through", async () => {
    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.notEqual(result, null);
    assert.equal(result?.commentary.headline, "LONG {{5900}} above VWAP");
    assert.equal(auditLogCalls.length, 0);
  });

  test("no audit log when DB unavailable on grounding failure", async () => {
    dbIsConfigured = false;
    mockGrounded = false;
    mockUngroundedValue = 9999;

    const result = await generateSpxCommentary(fakeDesk(), null);

    assert.equal(result, null);
    assert.equal(auditLogCalls.length, 0);
  });
});
