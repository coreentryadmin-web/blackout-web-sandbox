import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlaybookExitPlan } from "./playbook-exit-engines";
import type { SpxDeskPayload } from "./spx-desk";
import type { OpenPlayRow } from "./spx-play-store";
import { buildVolatilityContext } from "./playbook-volatility-context";

function desk(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 6000, kind: "resistance", net_gex: 1, label: "call" },
      { strike: 5980, kind: "support", net_gex: -1, label: "put" },
    ],
    price: 5995,
    vix: 14,
    ...overrides,
  } as SpxDeskPayload;
}

function row(id: number): OpenPlayRow {
  return {
    id,
    session_date: "2026-07-11",
    direction: "short",
    entry_price: 6000,
    entry_score: 70,
    stop: 6010,
    target: 5980,
    grade: "A",
    headline: "test",
    opened_at: new Date().toISOString(),
    trim_done: false,
    mfe_pts: 8,
    mae_pts: 1,
    status: "open",
    playbook_id: "PB-04",
  };
}

test("PB-04: gamma pin release debounced across polls", () => {
  const input = {
    playbook_id: "PB-04" as const,
    desk: desk({ gamma_regime: "amplification" }),
    technicals: null,
    row: row(42),
    direction: "short" as const,
    price: 5995,
    confluence_score: 60,
    entry_score: 70,
    mfe_pts: 8,
    vol_ctx: buildVolatilityContext(desk(), null),
    desk_stale: false,
    force_exit: false,
  };

  const first = evaluatePlaybookExitPlan(input);
  assert.equal(
    first.signals.some((s) => s.reason === "PB-04 gamma pin released"),
    false
  );

  const second = evaluatePlaybookExitPlan(input);
  assert.equal(
    second.signals.some((s) => s.reason === "PB-04 gamma pin released"),
    false
  );

  const third = evaluatePlaybookExitPlan(input);
  assert.ok(third.signals.some((s) => s.reason === "PB-04 gamma pin released"));
});
