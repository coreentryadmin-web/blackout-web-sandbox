import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeOvernightEvidence,
  buildOvernightInputs,
  detectCatalystPlay,
  parseWallStrike,
  sectorChangeFor,
  latestFlowTimestamp,
  WEAK_MAX_SCORE,
  type OvernightInputs,
} from "./cortex-overnight";
import { deriveDarkPoolTrendEvidence } from "./cortex-overnight/sources/darkpool-trend";
import { deriveIvTermEvidence } from "./cortex-overnight/sources/iv-term";
import { deriveSectorBreadthEvidence } from "./cortex-overnight/sources/sector-breadth";
import { deriveFlowPersistenceEvidence } from "./cortex-overnight/sources/flow-persistence";
import { buildNighthawkStageRejectedAuditRow } from "./play-outcomes";
import { buildNighthawkPublishContext } from "./publish-context";
import type { PlaybookPlay } from "./types";

const NOW = "2026-07-14T21:00:00Z";
const HORIZON = "2026-07-15";

function emptyInput(over: Partial<OvernightInputs> = {}): OvernightInputs {
  return {
    ticker: "NVDA",
    direction: "long",
    now: NOW,
    horizonDate: HORIZON,
    catalyst: null,
    wall: null,
    darkPool: null,
    iv: null,
    sector: null,
    flow: null,
    errors: {},
    ...over,
  };
}

// ── compose: total-outage ABSTAIN (never blocks the book) ───────────────────
test("compose: every source absent → ABSTAIN (PASS, flagged no-overnight-evidence), NOT a block", () => {
  const v = composeOvernightEvidence(emptyInput());
  assert.equal(v.verdict, "PASS");
  assert.equal(v.abstained, true);
  assert.equal(v.score, 0);
  assert.equal(v.vetoes.length, 0);
  assert.deepEqual(v.flags, ["no-overnight-evidence"]);
  assert.match(v.narrative[0], /abstained/);
});

// ── compose: veto asymmetry — one binary event blocks regardless of supports ─
test("compose: a catalyst veto forces VETO even with positive supports (unbounded veto)", () => {
  const v = composeOvernightEvidence(
    emptyInput({
      catalyst: {
        asOf: NOW,
        earningsDate: HORIZON,
        earningsReportTime: "premarket",
        binaryEvents: [],
        isCatalystPlay: false,
      },
      // a strong aligned dark-pool support that must NOT rescue the play
      darkPool: { asOf: NOW, bias: "bullish", totalPremium: 40_000_000, callPremium: 30_000_000, putPremium: 10_000_000 },
    })
  );
  assert.equal(v.verdict, "VETO");
  assert.equal(v.vetoes.length, 1);
  assert.ok(v.supports.length >= 1, "supports still recorded for the ledger");
  assert.match(v.narrative[0], /VETO/);
});

// ── compose: net-score math + WEAK banding ──────────────────────────────────
test("compose: net score = Σcapped-supports − Σopposes; non-positive net ⇒ WEAK (no veto)", () => {
  // dark-pool OPPOSED (-0.7) + no supports ⇒ score -0.7 ⇒ WEAK
  const weak = composeOvernightEvidence(
    emptyInput({
      darkPool: { asOf: NOW, bias: "bearish", totalPremium: 30_000_000, callPremium: 5_000_000, putPremium: 25_000_000 },
    })
  );
  assert.equal(weak.vetoes.length, 0);
  assert.ok(weak.score <= WEAK_MAX_SCORE);
  assert.equal(weak.verdict, "WEAK");
  assert.deepEqual(weak.flags, ["weak-overnight-evidence"]);

  // add the clean-catalyst support (+0.3) and an aligned dark pool (+0.5) ⇒ positive ⇒ PASS
  const pass = composeOvernightEvidence(
    emptyInput({
      catalyst: { asOf: NOW, earningsDate: null, earningsReportTime: null, binaryEvents: [], isCatalystPlay: false },
      darkPool: { asOf: NOW, bias: "bullish", totalPremium: 30_000_000, callPremium: 25_000_000, putPremium: 5_000_000 },
    })
  );
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.abstained, false);
  assert.ok(pass.score > WEAK_MAX_SCORE);
  // score = clear(0.3) + darkpool aligned(0.5) = 0.8
  assert.equal(pass.score, 0.8);
});

test("compose: invalid now throws (no silent Date.now fallback)", () => {
  assert.throws(() => composeOvernightEvidence(emptyInput({ now: "not-a-date" })), /invalid input.now/);
});

// ── remaining source modules (fail-soft + direction sensitivity) ────────────
test("darkpool-trend: opposed bias is a heavier oppose than aligned is a support; sub-floor is absent", () => {
  const opp = deriveDarkPoolTrendEvidence(
    emptyInput({ direction: "long", darkPool: { asOf: NOW, bias: "bearish", totalPremium: 20_000_000, callPremium: 2_000_000, putPremium: 18_000_000 } })
  );
  assert.equal(opp[0].stance, "opposes");
  const sml = deriveDarkPoolTrendEvidence(
    emptyInput({ darkPool: { asOf: NOW, bias: "bullish", totalPremium: 1_000_000, callPremium: 800_000, putPremium: 200_000 } })
  );
  assert.equal(sml[0].stance, "absent"); // below the structural floor
});

test("iv-term: high IV rank opposes overnight carry; missing IV is absent", () => {
  const hi = deriveIvTermEvidence(emptyInput({ iv: { asOf: NOW, ivRank: 92, term: [], realizedVol: null } }));
  assert.equal(hi[0].stance, "opposes");
  assert.equal(deriveIvTermEvidence(emptyInput({ iv: null }))[0].stance, "absent");
});

test("sector-breadth: a LONG into a bearish sector AND bearish breadth stacks two opposes (N-4)", () => {
  const items = deriveSectorBreadthEvidence(
    emptyInput({
      direction: "long",
      sector: { asOf: NOW, sectorName: "Technology", sectorChangePct: -1.2, breadthAdvancingFrac: 0.31, tickerChangePct: null },
    })
  );
  assert.equal(items.filter((i) => i.stance === "opposes").length, 2);
});

test("flow-persistence: multi-day streak supports; a spent morning splash opposes", () => {
  const streak = deriveFlowPersistenceEvidence(emptyInput({ flow: { asOf: NOW, streakDays: 3, flowCount: 5, lastPrintAt: null } }));
  assert.equal(streak[0].stance, "supports");
  const splash = deriveFlowPersistenceEvidence(
    emptyInput({ flow: { asOf: NOW, streakDays: 0, flowCount: 1, lastPrintAt: "2026-07-14T14:00:00Z" } }) // 10:00 ET
  );
  assert.equal(splash[0].stance, "opposes");
});

// ── build-inputs: pure helpers + fail-soft snapshot assembly ────────────────
test("detectCatalystPlay: fires on an explicit earnings/FDA play, not a passing mention", () => {
  assert.equal(detectCatalystPlay({ thesis: "classic earnings play into the print" } as PlaybookPlay), true);
  assert.equal(detectCatalystPlay({ thesis: "flow-driven momentum long", key_signal: "sweeps" } as PlaybookPlay), false);
});

test("parseWallStrike / sectorChangeFor / latestFlowTimestamp helpers", () => {
  assert.equal(parseWallStrike("call wall $470 (+5pts) · put wall $460 (-5pts)", "call"), 470);
  assert.equal(parseWallStrike("call wall $470 · put wall $460", "put"), 460);
  assert.equal(parseWallStrike("n/a", "call"), null);
  assert.deepEqual(sectorChangeFor("Technology Services", [{ name: "Technology", change_pct: -0.8 }]), { name: "Technology", changePct: -0.8 });
  assert.equal(sectorChangeFor(null, []), null);
  assert.equal(latestFlowTimestamp([{ executed_at: "2026-07-14T14:00:00Z" }, { executed_at: "2026-07-14T19:30:00Z" }]), "2026-07-14T19:30:00.000Z");
});

test("buildOvernightInputs: maps ctx+dossier and is fail-soft (empty dossier ⇒ null slices, abstain)", async () => {
  const play = { ticker: "NVDA", direction: "LONG", thesis: "flow long", target: "175" } as PlaybookPlay;
  const inputs = await buildOvernightInputs({
    play,
    dossier: null,
    ctx: { today: "2026-07-14", tomorrow: HORIZON, tomorrow_earnings: [], sector_performance: [], market_breadth: null },
    now: NOW,
    horizonDate: HORIZON,
  });
  // catalyst slice is present (calendar was fetched, ticker not in it) ⇒ clean support, not absent
  assert.ok(inputs.catalyst);
  assert.equal(inputs.catalyst!.earningsDate, null);
  assert.equal(inputs.wall, null); // no dossier ⇒ no positioning
  const v = composeOvernightEvidence(inputs);
  assert.equal(v.verdict, "PASS"); // clean catalyst support ⇒ not a block
});

test("buildOvernightInputs: earnings-tomorrow row → catalyst slice that composes to a VETO", async () => {
  const play = { ticker: "NVDA", direction: "LONG", thesis: "flow long", target: "175" } as PlaybookPlay;
  const inputs = await buildOvernightInputs({
    play,
    dossier: null,
    ctx: {
      today: "2026-07-14",
      tomorrow: HORIZON,
      tomorrow_earnings: [{ ticker: "NVDA", report_time: "premarket" }],
      sector_performance: [],
      market_breadth: null,
    },
    now: NOW,
    horizonDate: HORIZON,
  });
  assert.equal(inputs.catalyst!.earningsDate, HORIZON);
  assert.equal(inputs.catalyst!.earningsReportTime, "premarket");
  assert.equal(composeOvernightEvidence(inputs).verdict, "VETO");
});

// ── integration: a VETO verdict builds a valid nighthawk_rejected audit row ──
test("cortex veto → nighthawk_rejected audit row (counterfactual-gradeable record)", () => {
  const play = { ticker: "NVDA", direction: "LONG", conviction: "A", score: 71, entry_range: "170-171", target: "175", stop: "168" } as PlaybookPlay;
  const verdict = composeOvernightEvidence(
    emptyInput({ catalyst: { asOf: NOW, earningsDate: HORIZON, earningsReportTime: "premarket", binaryEvents: [], isCatalystPlay: false } })
  );
  const row = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "NVDA",
      play,
      detail: {
        stage: "cortex_overnight_veto",
        score: verdict.score,
        veto_reasons: verdict.vetoes.map((x) => x.detail),
        verdict: verdict as unknown as Record<string, unknown>,
      },
    },
    HORIZON
  );
  assert.equal(row.alert_type, "nighthawk_rejected");
  assert.equal(row.final_output, null); // never shown to a member
  assert.match(row.trigger_reason, /overnight Cortex/);
  assert.ok(row.decision_trace.some((t) => t.check.startsWith("cortex_overnight_veto_")));
  assert.equal((row.input_snapshot as Record<string, unknown>).cortex_overnight_score, verdict.score);
});

// ── integration: PASS/WEAK verdict is pinned into publish_context.cortex_overnight ──
test("publish_context pins the composed overnight verdict (calibration substrate)", () => {
  const play = { ticker: "NVDA", direction: "LONG", conviction: "B", score: 60, entry_range: "170-171", target: "173", stop: "168" } as PlaybookPlay;
  const verdict = composeOvernightEvidence(emptyInput({ catalyst: { asOf: NOW, earningsDate: null, earningsReportTime: null, binaryEvents: [], isCatalystPlay: false } }));
  const pin = buildNighthawkPublishContext({
    play,
    scored: null,
    dossier: null,
    market: { regime: null, market_breadth: null, tomorrow_earnings: [], tomorrow: HORIZON, vix_close: null, spx_close: null },
    builtAt: NOW,
    cortexOvernight: verdict as unknown as Record<string, unknown>,
  });
  assert.ok(pin.cortex_overnight, "cortex_overnight key present");
  assert.equal((pin.cortex_overnight as Record<string, unknown>).verdict, "PASS");
});
