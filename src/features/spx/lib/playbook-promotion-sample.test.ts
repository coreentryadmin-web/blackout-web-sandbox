import test from "node:test";
import assert from "node:assert/strict";
import {
  assessPlaybookEvidenceAlerts,
  dataQualitySessionFraction,
  sessionSnapshotDataQualityOk,
  type PlaybookPromotionEvidenceRow,
} from "./playbook-promotion-sample";
import type { PlaybookEvidenceSummary } from "./playbook-promotion-sample";

function row(
  overrides: Partial<PlaybookPromotionEvidenceRow> = {}
): PlaybookPromotionEvidenceRow {
  return {
    instance_id: "inst-1",
    session_date: "2026-07-10",
    playbook_id: "PB-01",
    armed_at: null,
    triggered_at: "2026-07-10T14:00:00Z",
    opened_at: null,
    reason_blocked: null,
    counterfactual_mfe_pts: null,
    counterfactual_mae_pts: null,
    counterfactual_eval: null,
    option_contract_candidate: null,
    pnl_pts: null,
    mfe_pts: null,
    mae_pts: null,
    outcome: null,
    execution_sim: null,
    has_execution_sim: false,
    blocked_events: 0,
    trigger_feature_snapshot: goodSnap(),
    ...overrides,
  };
}

function goodSnap(overrides: Record<string, unknown> = {}) {
  return {
    desk_stale: false,
    halt_channel_stale: false,
    gex_missing: false,
    vwap_volume_weighted: true,
    vix: 18,
    ...overrides,
  };
}

test("sessionSnapshotDataQualityOk: PB-01 fails when vwap not volume-weighted", () => {
  assert.equal(
    sessionSnapshotDataQualityOk(goodSnap({ vwap_volume_weighted: false }), "PB-01"),
    false
  );
});

test("sessionSnapshotDataQualityOk: PB-03 ignores vwap_volume_weighted", () => {
  assert.equal(
    sessionSnapshotDataQualityOk(goodSnap({ vwap_volume_weighted: false }), "PB-03"),
    true
  );
});

test("sessionSnapshotDataQualityOk: desk_stale fails", () => {
  assert.equal(sessionSnapshotDataQualityOk(goodSnap({ desk_stale: true }), "PB-01"), false);
});

test("sessionSnapshotDataQualityOk: PB-04 fails when gex_missing", () => {
  assert.equal(sessionSnapshotDataQualityOk(goodSnap({ gex_missing: true }), "PB-04"), false);
  assert.equal(sessionSnapshotDataQualityOk(goodSnap({ gex_missing: true }), "PB-01"), true);
});

test("sessionSnapshotDataQualityOk: PB-03 fails on stale halt feed", () => {
  assert.equal(
    sessionSnapshotDataQualityOk(goodSnap({ halt_channel_stale: true }), "PB-03"),
    false
  );
});

test("sessionSnapshotDataQualityOk: PB-08 fails when vix missing", () => {
  assert.equal(sessionSnapshotDataQualityOk(goodSnap({ vix: null }), "PB-08"), false);
});

test("sessionSnapshotDataQualityOk: missing snapshot is null", () => {
  assert.equal(sessionSnapshotDataQualityOk(null, "PB-01"), null);
});

test("dataQualitySessionFraction: all good sessions → 1", () => {
  const frac = dataQualitySessionFraction(
    [
      row({ session_date: "2026-07-10", trigger_feature_snapshot: goodSnap() }),
      row({ session_date: "2026-07-11", trigger_feature_snapshot: goodSnap() }),
    ],
    "PB-01"
  );
  assert.equal(frac, 1);
});

test("dataQualitySessionFraction: mixed sessions → 0.5", () => {
  const frac = dataQualitySessionFraction(
    [
      row({ session_date: "2026-07-10", trigger_feature_snapshot: goodSnap() }),
      row({
        session_date: "2026-07-11",
        trigger_feature_snapshot: goodSnap({ vwap_volume_weighted: false }),
      }),
    ],
    "PB-01"
  );
  assert.equal(frac, 0.5);
});

test("dataQualitySessionFraction: no trigger snapshots → null", () => {
  const frac = dataQualitySessionFraction(
    [row({ triggered_at: null, trigger_feature_snapshot: null })],
    "PB-01"
  );
  assert.equal(frac, null);
});

test("dataQualitySessionFraction: same session requires all rows OK", () => {
  const frac = dataQualitySessionFraction(
    [
      row({
        instance_id: "a",
        session_date: "2026-07-10",
        trigger_feature_snapshot: goodSnap(),
      }),
      row({
        instance_id: "b",
        session_date: "2026-07-10",
        trigger_feature_snapshot: goodSnap({ vwap_volume_weighted: false }),
      }),
    ],
    "PB-02"
  );
  assert.equal(frac, 0);
});

test("assessPlaybookEvidenceAlerts: fail on data_quality gate for allowlisted PB", () => {
  const summary: PlaybookEvidenceSummary = {
    playbook_id: "PB-01",
    armed: 1,
    triggered: 3,
    blocked: 0,
    executable_proxy: 3,
    opened: 0,
    closed: 0,
    unique_sessions: 2,
    win_rate: null,
    mean_return_pts: null,
    median_return_pts: null,
    profit_factor: null,
    expectancy_pts: null,
    median_mae_pts: null,
    median_mfe_pts: null,
    median_counterfactual_mfe: null,
    median_counterfactual_mae: null,
    counterfactual_comparable_instances: 0,
    promotion_tier: "insufficient",
    promotion_stats: {
      unique_sessions: 0,
      unique_market_conditions: 0,
      closed_trades: 0,
      mean_return_pts: null,
      median_return_pts: null,
      trimmed_mean_return_pts: null,
      expectancy_adverse_pts: null,
      best_trade_profit_share: null,
      best_session_profit_share: null,
      p5_return_pts: null,
      walk_forward_positive_windows: 0,
      counterfactual_comparable_count: 0,
    },
    promotion_gates_failed: ["data_quality_session_coverage"],
  };
  const alerts = assessPlaybookEvidenceAlerts([summary]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.level, "fail");
});
