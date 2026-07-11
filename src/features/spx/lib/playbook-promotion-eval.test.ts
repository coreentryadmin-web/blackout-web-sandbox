import test from "node:test";
import assert from "node:assert/strict";
import {
  adverseSlippageReturns,
  bestSessionProfitShare,
  bestTradeProfitShare,
  evaluatePlaybookPromotion,
  trimmedMean,
  walkForwardPositiveWindows,
} from "./playbook-promotion-eval";
import type { PlaybookPromotionTradeRow } from "./playbook-promotion-eval";

function trade(
  session: string,
  ret: number,
  cost = 0.1,
  bucket = "vix_mid|γ:amplification|r:trend_up"
): PlaybookPromotionTradeRow {
  return {
    session_date: session,
    return_pts: ret,
    round_trip_cost_pts: cost,
    market_condition_bucket: bucket,
    has_execution_sim: true,
  };
}

test("bestTradeProfitShare: flags outlier concentration", () => {
  const share = bestTradeProfitShare([1, 1, 1, 10]);
  assert.ok(share != null && share > 0.7);
});

test("trimmedMean: dampens outliers with enough samples", () => {
  const t = trimmedMean([1, 1, 1, 1, 1, 1, 1, 1, 1, 50]);
  assert.ok(t != null && t < 3);
});

test("walkForwardPositiveWindows: needs 3 session thirds", () => {
  const trades = [
    ...["2026-07-01", "2026-07-02", "2026-07-03"].map((d) => trade(d, 2)),
    ...["2026-07-08", "2026-07-09", "2026-07-10"].map((d) => trade(d, -1)),
    ...["2026-07-15", "2026-07-16", "2026-07-17"].map((d) => trade(d, 1)),
  ];
  assert.equal(walkForwardPositiveWindows(trades), 2);
});

test("adverseSlippageReturns: subtracts extra cost", () => {
  const stressed = adverseSlippageReturns([trade("2026-07-01", 2, 0.2)], 1.5);
  assert.ok(stressed[0]! < 2);
});

test("evaluatePlaybookPromotion: insufficient without sessions", () => {
  const ev = evaluatePlaybookPromotion({
    playbook_id: "PB-01",
    triggers: 5,
    simulated_trades: 2,
    trades: [trade("2026-07-01", 1)],
  });
  assert.equal(ev.tier, "insufficient");
  assert.ok(ev.gates.some((g) => g.gate === "min_triggers" && !g.pass));
  const dq = ev.gates.find((g) => g.gate === "data_quality_session_coverage");
  assert.ok(dq?.pass);
  assert.match(dq?.detail ?? "", /no trigger-time feature snapshots/);
});

test("evaluatePlaybookPromotion: data_quality_session_coverage enforces fraction when set", () => {
  const ev = evaluatePlaybookPromotion({
    playbook_id: "PB-01",
    triggers: 50,
    simulated_trades: 40,
    data_quality_session_fraction: 0.8,
    trades: Array.from({ length: 12 }, (_, i) =>
      trade(`2026-07-${String(i + 1).padStart(2, "0")}`, 1)
    ),
  });
  const dq = ev.gates.find((g) => g.gate === "data_quality_session_coverage");
  assert.ok(dq);
  assert.equal(dq.pass, false);
});

test("bestSessionProfitShare: one CPI day dominance", () => {
  const trades = [
    trade("2026-07-01", 0.5),
    trade("2026-07-01", 0.5),
    trade("2026-07-02", 8),
  ];
  const share = bestSessionProfitShare(trades);
  assert.ok(share != null && share > 0.85);
});
