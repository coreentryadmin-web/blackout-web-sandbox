import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkRejectionDetail } from "./play-outcomes";
import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";

// Task #141: Night Hawk's synthesis funnel has 4 real rejection stages AFTER a candidate has
// already survived the trade-geometry gate — premium-cap, illiquid-strike, ungrounded, and
// sector-concentration — and before this task NONE of them wrote anything durable (each was a
// console.warn only, in claude-edition.ts / play-constraints.ts / grounding.ts). This suite
// proves recordNighthawkStageRejectedAuditTrail (play-outcomes.ts) — the function
// edition-builder.ts now calls for all 4 — actually reaches insertNighthawkRejectedAuditLog
// (i.e. `alert_audit_log`) with the right alert_type/trigger_reason/decision_trace/
// input_snapshot for each stage, not just that the pure row-builder produces the right shape
// (already covered fixture-only in play-outcomes.test.ts).
//
// mock.module idiom mirrors edition-builder-scoring-history.test.ts exactly: play-outcomes.ts
// statically imports several OTHER names from "@/lib/db" besides insertNighthawkRejectedAuditLog
// (fetchPendingNighthawkOutcomes, insertAlertAuditLog, pruneNighthawkPlayOutcomesForEdition,
// upsertNighthawkPlayOutcomes, updateNighthawkPlayOutcome) — mock.module's namedExports FULLY
// REPLACES the module (no merge with the real one), so the real module must be imported first
// and spread, overriding only the one function this suite drives. Relative specifier ("../db"),
// NEVER the "@/" alias — this repo's documented Node 20 mock.module crash (see
// docs/audit/FINDINGS.md's "get_positioning" / gex_king_strike entry: an alias specifier inside
// mock.module() throws ERR_MODULE_NOT_FOUND under Node 20 even though it works under Node 22).

type InsertedRow = {
  source_key: Record<string, unknown>;
  ticker: string;
  direction: string | null;
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string | null;
  decision_trace: unknown;
  input_snapshot: Record<string, unknown> | null;
};

const state = {
  inserted: [] as InsertedRow[],
  shouldThrow: false,
};

function resetState() {
  state.inserted = [];
  state.shouldThrow = false;
}

before(async () => {
  const realDb = await import("../db");
  mock.module("../db", {
    namedExports: {
      ...realDb,
      insertNighthawkRejectedAuditLog: async (row: InsertedRow) => {
        if (state.shouldThrow) throw new Error("transient DB error");
        state.inserted.push(row);
      },
    },
  });
});

// Lazy import (ESM caches the module under test after the first call) so the mock above is in
// place before play-outcomes.ts's own top-level "@/lib/db" import resolves — same idiom
// edition-builder-scoring-history.test.ts uses for this exact file.
const mod = () => import("./play-outcomes");

function play(overrides: Partial<PlaybookPlay>): PlaybookPlay {
  return {
    rank: 1,
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$100-$104",
    target: "$112.50",
    stop: "$96",
    options_play: "TEST 110C 08/21",
    score: 70,
    ...overrides,
  };
}

// Fire-and-forget: recordNighthawkStageRejectedAuditTrail doesn't return a promise the caller
// can await (by design — a slow/failing audit write must never block edition publishing), so
// tests give the internal insertNighthawkRejectedAuditLog(...).catch(...) chain one microtask
// turn to settle before asserting.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("recordNighthawkStageRejectedAuditTrail: premium-cap rejection lands a queryable row with the actual premium + cap", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "NVDA", entry_premium: 27.5, entry_cost_per_contract: 2750 });
  const detail: NighthawkRejectionDetail = {
    stage: "premium_cap",
    entry_premium: 27.5,
    cap_per_share: 20,
    entry_cost_per_contract: 2750,
    cap_per_contract: 2000,
  };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "NVDA", play: p, detail }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.equal(row.ticker, "NVDA");
  assert.deepEqual(row.source_key, { edition_for: "2026-07-06", ticker: "NVDA" });
  assert.match(row.trigger_reason ?? "", /premium|afford/i);
  assert.deepEqual(row.decision_trace, [
    { check: "premium_within_cap", passed: false, value: 27.5, threshold: 20 },
  ]);
  assert.equal((row.input_snapshot as { entry_premium: number }).entry_premium, 27.5);
  assert.equal((row.input_snapshot as { cap_per_share: number }).cap_per_share, 20);
});

test("recordNighthawkStageRejectedAuditTrail: illiquid-strike rejection lands a row with strike/OI/floor", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "SNDK", options_play: "SNDK 190C 09/18" });
  const detail: NighthawkRejectionDetail = {
    stage: "illiquid_strike",
    strike: 190,
    side: "call",
    expiry: "2026-09-18",
    open_interest: 220,
    min_open_interest: 500,
  };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "SNDK", play: p, detail }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.match(row.trigger_reason ?? "", /illiquid|open interest/i);
  assert.deepEqual(row.decision_trace, [
    { check: "strike_open_interest", passed: false, value: 220, threshold: 500 },
  ]);
  assert.equal((row.input_snapshot as { open_interest: number }).open_interest, 220);
});

test("recordNighthawkStageRejectedAuditTrail: ungrounded rejection lands a row citing the failed claim(s)", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "AVGO", direction: "SHORT" });
  const issues = [{ check: "levels", detail: "AVGO target $1800 does not trace to any dossier S/R or chain strike (±2%)." }];
  const detail: NighthawkRejectionDetail = { stage: "ungrounded", issues };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "AVGO", play: p, detail }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.match(row.trigger_reason ?? "", /ground/i);
  assert.equal((row.decision_trace as Array<{ value: unknown }>)[0]!.value, issues[0]!.detail);
});

test("recordNighthawkStageRejectedAuditTrail: sector-concentration rejection lands a row with sector + fill count", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "AMD" });
  const detail: NighthawkRejectionDetail = {
    stage: "sector_concentration",
    sector: "semis",
    already_filled: 2,
    max_per_sector: 2,
  };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "AMD", play: p, detail }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.match(row.trigger_reason ?? "", /sector-concentration/i);
  assert.equal((row.input_snapshot as { already_filled: number }).already_filled, 2);
});

test("recordNighthawkStageRejectedAuditTrail: multiple stages in one edition each write their own row", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  recordNighthawkStageRejectedAuditTrail(
    [
      {
        ticker: "AAA",
        play: play({ ticker: "AAA" }),
        detail: { stage: "premium_cap", entry_premium: 30, cap_per_share: 20, entry_cost_per_contract: 3000, cap_per_contract: 2000 },
      },
      {
        ticker: "BBB",
        play: play({ ticker: "BBB" }),
        detail: { stage: "sector_concentration", sector: "energy", already_filled: 2, max_per_sector: 2 },
      },
    ],
    "2026-07-06"
  );
  await flush();

  assert.equal(state.inserted.length, 2);
  assert.deepEqual(state.inserted.map((r) => r.ticker).sort(), ["AAA", "BBB"]);
});

// ── Confluence-factor pass-through reaches the actual DB write (task #142) ────────
// play-outcomes.test.ts proves the pure builders fold `scored` into input_snapshot.confluence
// correctly (fixture-only, no DB). This proves the end-to-end path — the SAME optional
// `scored` field threaded from a caller (edition-builder.ts, via claude-edition.ts's
// dossierMap lookup) all the way to the row insertNighthawkRejectedAuditLog actually receives.

const SCORED_FIXTURE: ScoredCandidate = {
  ticker: "NVDA",
  score: 91,
  direction: "long",
  flow_score: 32,
  tech_score: 25,
  pos_score: 15,
  news_score: 11,
  smart_money_score: 8,
  conviction: "A",
};

test("recordNighthawkStageRejectedAuditTrail: scored candidate's confluence breakdown reaches the written row", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "NVDA", entry_premium: 27.5, entry_cost_per_contract: 2750 });
  const detail: NighthawkRejectionDetail = {
    stage: "premium_cap",
    entry_premium: 27.5,
    cap_per_share: 20,
    entry_cost_per_contract: 2750,
    cap_per_contract: 2000,
  };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "NVDA", play: p, detail, scored: SCORED_FIXTURE }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  const confluence = (state.inserted[0]!.input_snapshot as { confluence: Record<string, unknown> }).confluence;
  assert.equal(confluence.total_score, 91);
  assert.equal(confluence.flow_score, 32);
  assert.equal(confluence.smart_money_score, 8);
});

test("recordNighthawkStageRejectedAuditTrail: omitting scored writes confluence:null, never a fabricated reading", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "AMD" });
  const detail: NighthawkRejectionDetail = {
    stage: "sector_concentration",
    sector: "semis",
    already_filled: 2,
    max_per_sector: 2,
  };
  recordNighthawkStageRejectedAuditTrail([{ ticker: "AMD", play: p, detail }], "2026-07-06");
  await flush();

  assert.equal(state.inserted.length, 1);
  assert.equal((state.inserted[0]!.input_snapshot as { confluence: unknown }).confluence, null);
});

test("recordNighthawkRejectedAuditTrail (geometry): scored candidate's confluence breakdown reaches the written row via the thin wrapper", async () => {
  const { recordNighthawkRejectedAuditTrail } = await mod();
  resetState();

  const p = play({ ticker: "TSLA" });
  recordNighthawkRejectedAuditTrail(
    [{ ticker: "TSLA", drops: ["target on wrong side of entry"], play: p, scored: SCORED_FIXTURE }],
    "2026-07-06"
  );
  await flush();

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.equal(row.ticker, "TSLA");
  const confluence = (row.input_snapshot as { confluence: Record<string, unknown> }).confluence;
  assert.equal(confluence.total_score, 91);
  assert.equal(confluence.conviction, "A");
});

test("recordNighthawkStageRejectedAuditTrail: a write failure is swallowed, never thrown (must not break publishing)", async () => {
  const { recordNighthawkStageRejectedAuditTrail } = await mod();
  resetState();
  state.shouldThrow = true;

  assert.doesNotThrow(() => {
    recordNighthawkStageRejectedAuditTrail(
      [
        {
          ticker: "CCC",
          play: play({ ticker: "CCC" }),
          detail: { stage: "illiquid_strike", strike: 100, side: "put", expiry: null, open_interest: 10, min_open_interest: 500 },
        },
      ],
      "2026-07-06"
    );
  });
  await flush();

  assert.equal(state.inserted.length, 0, "the throwing insert must not have recorded a row");
});
