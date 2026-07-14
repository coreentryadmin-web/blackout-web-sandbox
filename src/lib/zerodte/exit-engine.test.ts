// Pure table tests for the 0DTE exit engine (B-8). No mocks, no IO, no clock:
// exit-engine.ts is a dependency-free leaf (marks-math + cortex types only), so
// every rule fires — and, just as important, DOESN'T fire — against literal inputs.
// Fixtures use entry 4.00 so P&L percentages read directly (5.00 = +25%, 6.00 =
// +50%, 2.00 = the −50% plan stop, 8.00 = the +100% target).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import {
  buildExitContext,
  detectThesisBreak,
  evaluateExitState,
  ratchetFloorPct,
  EXIT_RULES,
  type ExitEngineInput,
} from "./exit-engine";

const ENTRY = 4.0;

function input(overrides: Partial<ExitEngineInput> = {}): ExitEngineInput {
  return {
    entryPremium: ENTRY,
    currentMark: 4.0,
    peakPremium: 4.0,
    ageMinutes: 10,
    cortexEvidence: null,
    planStop: 2.0, // −50%
    planTarget: 8.0, // +100%
    status: "HOLD",
    trimmed: false,
    entryCortexScore: null,
    ...overrides,
  };
}

function evidence(items: Array<Partial<EvidenceItem>>): EvidenceItem[] {
  return items.map((it, i) => ({
    source: "gex-walls",
    stance: "opposes",
    weight: 1,
    halfLifeSec: 600,
    asOf: "2026-07-14T14:30:00.000Z",
    detail: `fixture evidence ${i}`,
    ...it,
  })) as EvidenceItem[];
}

// ── 1. Profit ratchet — never let green turn red ──────────────────────────────────

test("ratchet: below +25% peak nothing is armed — the trade keeps its room", () => {
  const d = evaluateExitState(input({ peakPremium: 4.96, currentMark: 3.92 })); // peak +24%, now −2%
  assert.equal(d.action, "HOLD");
  assert.equal(d.floorPnlPct, null);
  assert.equal(d.reason, "hold");
});

test("ratchet: +25% peak arms the breakeven floor (no exit while above it)", () => {
  const d = evaluateExitState(input({ peakPremium: 5.0, currentMark: 4.4 })); // peak +25%, now +10%
  assert.equal(d.action, "RAISE_FLOOR");
  assert.equal(d.floorPnlPct, 0);
  assert.equal(d.reason, "ratchet_breakeven_floor_set");
});

test("ratchet: a mark AT the breakeven floor after a +25% peak exits — green never finishes red", () => {
  const d = evaluateExitState(input({ peakPremium: 5.0, currentMark: 4.0 })); // back to 0%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
  assert.equal(d.floorPnlPct, 0);
});

test("ratchet: a mark BELOW the floor exits too (breach, not just touch)", () => {
  const d = evaluateExitState(input({ peakPremium: 5.0, currentMark: 3.9 })); // −2.5%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

test("ratchet: +50% peak raises the floor to +20%", () => {
  const hold = evaluateExitState(input({ peakPremium: 6.0, currentMark: 5.0 })); // peak +50%, now +25%
  assert.equal(hold.action, "RAISE_FLOOR");
  assert.equal(hold.floorPnlPct, 20);
  assert.equal(hold.reason, "ratchet_profit_floor_set");

  const exit = evaluateExitState(input({ peakPremium: 6.0, currentMark: 4.8 })); // exactly +20%
  assert.equal(exit.action, "EXIT");
  assert.equal(exit.reason, "ratchet_profit_floor");
  assert.equal(exit.floorPnlPct, 20);
});

test("ratchet: the floor is MONOTONIC — a deep retrace never lowers +20% back to breakeven", () => {
  // Peak +50% earlier; the mark has now retraced to +10%. If the floor re-derived
  // from the current mark it would read 0 (or null) — it must stay 20 and exit.
  const d = evaluateExitState(input({ peakPremium: 6.0, currentMark: 4.4 })); // +10%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_profit_floor");
  assert.equal(d.floorPnlPct, 20, "floor derives from the latched peak, never the retraced mark");
});

test("ratchetFloorPct: pure floor table (arm 25→0, lock 50→20, trim→50, monotonic in peak)", () => {
  assert.equal(ratchetFloorPct(null, false), null);
  assert.equal(ratchetFloorPct(24.99, false), null);
  assert.equal(ratchetFloorPct(25, false), 0);
  assert.equal(ratchetFloorPct(49.99, false), 0);
  assert.equal(ratchetFloorPct(50, false), 20);
  assert.equal(ratchetFloorPct(400, false), 20);
  assert.equal(ratchetFloorPct(10, true), EXIT_RULES.runner_floor_pct, "trim latch alone sets the runner floor");
});

test("runner floor: after a TRIM the remaining position never gives back below +50%", () => {
  const hold = evaluateExitState(input({ trimmed: true, status: "TRIM", peakPremium: 9.0, currentMark: 6.2 })); // +55%
  assert.equal(hold.action, "RAISE_FLOOR");
  assert.equal(hold.floorPnlPct, 50);
  assert.equal(hold.reason, "runner_floor_set");

  const exit = evaluateExitState(input({ trimmed: true, status: "TRIM", peakPremium: 9.0, currentMark: 6.0 })); // +50%
  assert.equal(exit.action, "EXIT");
  assert.equal(exit.reason, "runner_floor");
  assert.equal(exit.floorPnlPct, 50);
});

// ── 2. Thesis break — unconditional, evidence-driven ──────────────────────────────

test("thesis break: a single VETO-class item exits even at a −20% loss", () => {
  const d = evaluateExitState(
    input({
      currentMark: 3.2, // −20%: no floor armed (peak never reached +25%), above the plan stop
      peakPremium: 4.1,
      cortexEvidence: evidence([{ stance: "veto", source: "wall-trend", detail: "opposing wall building at 180" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:wall-trend");
  assert.match(d.detail, /opposing wall building/);
});

test("thesis break: ≥2 opposing items whose combined weight beats the entry margin exit", () => {
  const d = evaluateExitState(
    input({
      currentMark: 4.2,
      peakPremium: 4.3,
      entryCortexScore: 1.2,
      cortexEvidence: evidence([
        { stance: "opposes", source: "flow-quality", weight: 0.9 },
        { stance: "opposes", source: "gex-walls", weight: 0.8 }, // combined 1.7 > 1.2
      ]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:flow-quality", "reason carries the heaviest opposing source");
});

test("thesis break does NOT fire: one oppose (however heavy) is a data point, not a cluster", () => {
  const d = evaluateExitState(
    input({ cortexEvidence: evidence([{ stance: "opposes", weight: 3.0 }]) })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break does NOT fire: two opposes inside the entry's committed score margin", () => {
  const d = evaluateExitState(
    input({
      entryCortexScore: 2.0,
      cortexEvidence: evidence([
        { stance: "opposes", weight: 0.9 },
        { stance: "opposes", weight: 0.8 }, // combined 1.7 ≤ margin 2.0 — cushion holds
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break does NOT fire: two microscopic opposes stay under the noise floor when no entry score exists", () => {
  const d = evaluateExitState(
    input({
      entryCortexScore: null,
      cortexEvidence: evidence([
        { stance: "opposes", weight: 0.2 },
        { stance: "opposes", weight: 0.2 }, // 0.4 ≤ noise floor 0.5
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break: supports/absent stances never count toward a break", () => {
  const d = evaluateExitState(
    input({
      cortexEvidence: evidence([
        { stance: "supports", weight: 2 },
        { stance: "supports", weight: 2 },
        { stance: "absent", weight: 0 },
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("missing evidence NEVER exits: null cortexEvidence skips the thesis check only", () => {
  assert.equal(detectThesisBreak(null, 1), null);
  const d = evaluateExitState(input({ cortexEvidence: null, currentMark: 3.2, peakPremium: 4.1 }));
  assert.equal(d.action, "HOLD", "a −20% play with no evidence holds — the stop owns the downside");
});

// ── 3. Flat timeout — theta bleed ─────────────────────────────────────────────────

test("flat timeout: 45min inside the ±10% band exits as a scratch", () => {
  const d = evaluateExitState(input({ ageMinutes: 45, peakPremium: 4.3, currentMark: 3.8 })); // peak +7.5%, now −5%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "flat_theta_bleed");
});

test("flat timeout does NOT fire at 44 minutes", () => {
  const d = evaluateExitState(input({ ageMinutes: 44, peakPremium: 4.3, currentMark: 3.8 }));
  assert.equal(d.action, "HOLD");
});

test("flat timeout does NOT fire when the peak escaped the band (+12% had a pulse)", () => {
  const d = evaluateExitState(input({ ageMinutes: 90, peakPremium: 4.48, currentMark: 4.0 })); // peak +12%
  assert.equal(d.action, "HOLD");
});

test("flat timeout does NOT fire below the band — the stop rules own the losing tail", () => {
  const d = evaluateExitState(input({ ageMinutes: 90, peakPremium: 4.2, currentMark: 3.5 })); // −12.5%
  assert.equal(d.action, "HOLD");
});

// ── 4. Plan stop/target stay authoritative ────────────────────────────────────────

test("plan stop: mark at/below the printed stop exits with plan_stop when no floor is armed", () => {
  const d = evaluateExitState(input({ currentMark: 2.0, peakPremium: 4.2 }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_stop");
});

test("plan target: first touch TRIMs (bank half) and hands the runner a +50% floor", () => {
  const d = evaluateExitState(input({ currentMark: 8.0, peakPremium: 8.0 }));
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "plan_target_trim");
  assert.equal(d.floorPnlPct, EXIT_RULES.runner_floor_pct);
});

test("plan target: at/above target when already trimmed banks the runner in full", () => {
  const d = evaluateExitState(input({ currentMark: 8.2, peakPremium: 8.5, trimmed: true, status: "TRIM" }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_target_final");
});

// ── 5. Precedence collisions ──────────────────────────────────────────────────────

test("precedence: ratchet floor breach + thesis veto on the same tick → the floor reason wins", () => {
  const d = evaluateExitState(
    input({
      peakPremium: 5.2, // +30% → breakeven floor armed
      currentMark: 3.95, // below the floor
      cortexEvidence: evidence([{ stance: "veto", source: "flow-quality" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

test("precedence: stop AND floor breached together → the HIGHER protective mark labels the exit", () => {
  // Peak +50% → floor +20% (mark 4.8) vs plan stop 2.0: a crash through both in one
  // tick is labeled by the floor — the level that actually protected more.
  const d = evaluateExitState(input({ peakPremium: 6.0, currentMark: 1.9 }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_profit_floor");
});

test("precedence: thesis break outranks the plan target — evidence the play is wrong beats 'let it run'", () => {
  const d = evaluateExitState(
    input({
      currentMark: 8.4, // above target
      peakPremium: 8.4,
      cortexEvidence: evidence([{ stance: "veto", source: "catalyst-news" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:catalyst-news");
});

test("precedence: thesis break outranks the flat timeout", () => {
  const d = evaluateExitState(
    input({
      ageMinutes: 60,
      peakPremium: 4.2,
      currentMark: 4.0,
      cortexEvidence: evidence([{ stance: "veto", source: "sector-heat" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:sector-heat");
});

test("precedence: target TRIM outranks flat timeout (a doubled play is not 'flat')", () => {
  const d = evaluateExitState(input({ ageMinutes: 60, currentMark: 8.0, peakPremium: 8.0 }));
  assert.equal(d.action, "TRIM");
});

// ── 6. Guards — missing data never exits ──────────────────────────────────────────

test("guard: a CLOSED row is terminal — the engine never re-decides it", () => {
  const d = evaluateExitState(input({ status: "CLOSED", currentMark: 1.0 }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "already_closed");
});

test("guard: no live mark → HOLD, but the armed floor is still reported", () => {
  const d = evaluateExitState(input({ currentMark: null, peakPremium: 6.0 }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "no_live_mark");
  assert.equal(d.floorPnlPct, 20, "the floor stands even when this tick has no quote");
});

test("guard: no entry premium → HOLD (P&L underivable)", () => {
  const d = evaluateExitState(input({ entryPremium: null }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "no_entry_premium");
});

// ── 7. The counterfactual exit record ─────────────────────────────────────────────

test("buildExitContext: reason + rounded mark + pinned P&L + peak P&L + ISO stamp", () => {
  const decision = evaluateExitState(input({ peakPremium: 5.0, currentMark: 3.9 }));
  const ctx = buildExitContext(decision, ENTRY, 3.90000000004, 5.0, Date.UTC(2026, 6, 14, 15, 0, 0));
  assert.equal(ctx.reason, "ratchet_breakeven_floor");
  assert.equal(ctx.mark, 3.9, "rounded at the data layer — no malformed floats persist");
  assert.equal(ctx.pnl_pct, -2.5);
  assert.equal(ctx.peak_pnl_pct, 25);
  assert.equal(ctx.at, "2026-07-14T15:00:00.000Z");
});
