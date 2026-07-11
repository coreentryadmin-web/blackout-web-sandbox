/**
 * Evaluate playbook promotion samples against session-aware statistical gates.
 */
import {
  type PlaybookPromotionThresholds,
  type PlaybookPromotionTier,
  PROMOTION_LIMITED_LIVE_THRESHOLDS,
  PROMOTION_RESEARCH_THRESHOLDS,
  PROMOTION_STAGING_THRESHOLDS,
} from "@/features/spx/lib/playbook-promotion-requirements";
import { uniqueMarketConditionCount } from "@/features/spx/lib/playbook-market-condition-bucket";

export type PlaybookPromotionTradeRow = {
  session_date: string;
  return_pts: number;
  round_trip_cost_pts?: number | null;
  market_condition_bucket?: string | null;
  has_execution_sim?: boolean;
  counterfactual_comparable?: boolean;
  /** Per-trade data requirements satisfied (from evaluatePlaybookDataSatisfaction). */
  data_quality_satisfied?: boolean;
};

export type PlaybookPromotionSample = {
  playbook_id: string;
  triggers: number;
  simulated_trades: number;
  trades: PlaybookPromotionTradeRow[];
  /** Counterfactual rows sharing contract_version=1 + same horizon (comparable only). */
  counterfactual_comparable_count?: number;
  /**
   * Fraction of sample sessions with satisfied data requirements (0–1).
   * null/undefined = sample-builder not wired — gate passes inertly.
   */
  data_quality_session_fraction?: number | null;
};

export type PromotionGateResult = {
  gate: string;
  pass: boolean;
  detail: string;
  value?: number | string | null;
  threshold?: number | string | null;
};

export type PlaybookPromotionEval = {
  playbook_id: string;
  tier: PlaybookPromotionTier;
  gates: PromotionGateResult[];
  stats: {
    unique_sessions: number;
    unique_market_conditions: number;
    closed_trades: number;
    mean_return_pts: number | null;
    median_return_pts: number | null;
    trimmed_mean_return_pts: number | null;
    expectancy_adverse_pts: number | null;
    best_trade_profit_share: number | null;
    best_session_profit_share: number | null;
    p5_return_pts: number | null;
    walk_forward_positive_windows: number;
    counterfactual_comparable_count: number;
  };
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 10% trimmed mean — robust center vs outlier-driven mean. */
export function trimmedMean(nums: number[], trimFraction = 0.1): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const trim = Math.floor(s.length * trimFraction);
  const slice = s.slice(trim, s.length - trim || undefined);
  if (!slice.length) return median(s);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))));
  return s[idx]!;
}

function grossProfit(nums: number[]): number {
  return nums.filter((n) => n > 0).reduce((a, b) => a + b, 0);
}

export function bestTradeProfitShare(returns: number[]): number | null {
  const gp = grossProfit(returns);
  if (gp <= 0) return null;
  const best = Math.max(...returns.filter((n) => n > 0), 0);
  return best / gp;
}

export function bestSessionProfitShare(
  trades: PlaybookPromotionTradeRow[]
): number | null {
  const bySession = new Map<string, number>();
  for (const t of trades) {
    bySession.set(t.session_date, (bySession.get(t.session_date) ?? 0) + t.return_pts);
  }
  const sessionPnls = [...bySession.values()];
  const gp = grossProfit(sessionPnls);
  if (gp <= 0) return null;
  const best = Math.max(...sessionPnls.filter((n) => n > 0), 0);
  return best / gp;
}

/** Apply extra slippage stress — worse fills than lite_v1 assumed. */
export function adverseSlippageReturns(
  trades: PlaybookPromotionTradeRow[],
  multiplier: number
): number[] {
  return trades.map((t) => {
    const cost = t.round_trip_cost_pts ?? 0;
    const extra = cost * Math.max(0, multiplier - 1);
    return t.return_pts - extra;
  });
}

/** Chronological walk-forward: split sessions into thirds; count positive mean windows. */
export function walkForwardPositiveWindows(
  trades: PlaybookPromotionTradeRow[]
): number {
  const sessions = [...new Set(trades.map((t) => t.session_date))].sort();
  if (sessions.length < 3) return 0;
  const third = Math.max(1, Math.floor(sessions.length / 3));
  const windows: string[][] = [
    sessions.slice(0, third),
    sessions.slice(third, third * 2),
    sessions.slice(third * 2),
  ];
  let positive = 0;
  for (const win of windows) {
    const set = new Set(win);
    const rets = trades.filter((t) => set.has(t.session_date)).map((t) => t.return_pts);
    if (!rets.length) continue;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    if (mean > 0) positive += 1;
  }
  return positive;
}

function gate(
  id: string,
  pass: boolean,
  detail: string,
  value?: number | string | null,
  threshold?: number | string | null
): PromotionGateResult {
  return { gate: id, pass, detail, value, threshold };
}

export function evaluatePromotionGates(
  sample: PlaybookPromotionSample,
  thresholds: PlaybookPromotionThresholds
): PromotionGateResult[] {
  const returns = sample.trades.map((t) => t.return_pts);
  const sessions = new Set(sample.trades.map((t) => t.session_date));
  const conditions = sample.trades
    .map((t) => t.market_condition_bucket)
    .filter((b): b is string => Boolean(b));
  const uniqueConditions = uniqueMarketConditionCount(conditions);
  const med = median(returns);
  const tmean = trimmedMean(returns);
  const adverse = adverseSlippageReturns(sample.trades, thresholds.adverse_slippage_multiplier);
  const adverseMean = adverse.length
    ? adverse.reduce((a, b) => a + b, 0) / adverse.length
    : null;
  const bestTrade = bestTradeProfitShare(returns);
  const bestSession = bestSessionProfitShare(sample.trades);
  const p5 = percentile(returns, 0.05);
  const wf = walkForwardPositiveWindows(sample.trades);

  const dataQualityMinFraction = 0.95;
  const dqFraction = sample.data_quality_session_fraction;
  const gates: PromotionGateResult[] = [
    dqFraction != null
      ? gate(
          "data_quality_session_coverage",
          dqFraction >= dataQualityMinFraction,
          `data_quality_sessions=${(dqFraction * 100).toFixed(1)}% vs ${(dataQualityMinFraction * 100).toFixed(0)}%`,
          dqFraction,
          dataQualityMinFraction
        )
      : gate(
          "data_quality_session_coverage",
          true,
          "no trigger-time feature snapshots — data quality fraction unavailable",
          null,
          dataQualityMinFraction
        ),
    gate(
      "min_triggers",
      sample.triggers >= thresholds.min_triggers,
      `triggers ${sample.triggers} vs ${thresholds.min_triggers}`,
      sample.triggers,
      thresholds.min_triggers
    ),
    gate(
      "min_simulated_trades",
      sample.simulated_trades >= thresholds.min_simulated_trades,
      `simulated ${sample.simulated_trades} vs ${thresholds.min_simulated_trades}`,
      sample.simulated_trades,
      thresholds.min_simulated_trades
    ),
    gate(
      "min_sessions",
      sessions.size >= thresholds.min_sessions,
      `sessions ${sessions.size} vs ${thresholds.min_sessions}`,
      sessions.size,
      thresholds.min_sessions
    ),
    gate(
      "min_unique_market_conditions",
      uniqueConditions >= thresholds.min_unique_market_conditions,
      `conditions ${uniqueConditions} vs ${thresholds.min_unique_market_conditions}`,
      uniqueConditions,
      thresholds.min_unique_market_conditions
    ),
  ];

  if (thresholds.min_closed_trades > 0) {
    gates.push(
      gate(
        "min_closed_trades",
        returns.length >= thresholds.min_closed_trades,
        `closed ${returns.length} vs ${thresholds.min_closed_trades}`,
        returns.length,
        thresholds.min_closed_trades
      )
    );
  }

  if (thresholds.min_closed_trades > 0 && returns.length >= thresholds.min_closed_trades) {
    const robustPositive =
      (med != null && med > 0) || (tmean != null && tmean > 0);
    gates.push(
      gate(
        "positive_median_or_trimmed_mean",
        robustPositive,
        `median=${med?.toFixed(3) ?? "n/a"} trimmed_mean=${tmean?.toFixed(3) ?? "n/a"}`,
        med,
        ">0"
      )
    );
    gates.push(
      gate(
        "positive_expectancy_adverse_slippage",
        adverseMean != null && adverseMean > 0,
        `adverse_mean=${adverseMean?.toFixed(3) ?? "n/a"} (mult=${thresholds.adverse_slippage_multiplier})`,
        adverseMean,
        ">0"
      )
    );
    if (bestTrade != null) {
      gates.push(
        gate(
          "max_best_trade_profit_share",
          bestTrade <= thresholds.max_best_trade_profit_share,
          `best_trade_share=${(bestTrade * 100).toFixed(1)}%`,
          bestTrade,
          thresholds.max_best_trade_profit_share
        )
      );
    }
    if (bestSession != null) {
      gates.push(
        gate(
          "max_best_session_profit_share",
          bestSession <= thresholds.max_best_session_profit_share,
          `best_session_share=${(bestSession * 100).toFixed(1)}%`,
          bestSession,
          thresholds.max_best_session_profit_share
        )
      );
    }
    gates.push(
      gate(
        "walk_forward_consistency",
        wf >= thresholds.walk_forward_min_positive_windows,
        `positive_windows=${wf} vs ${thresholds.walk_forward_min_positive_windows}/3`,
        wf,
        thresholds.walk_forward_min_positive_windows
      )
    );
    gates.push(
      gate(
        "acceptable_tail_loss",
        p5 != null && p5 >= thresholds.p5_return_floor_pts,
        `p5=${p5?.toFixed(3) ?? "n/a"} vs floor ${thresholds.p5_return_floor_pts}`,
        p5,
        thresholds.p5_return_floor_pts
      )
    );
  }

  return gates;
}

function tierFromGates(
  sample: PlaybookPromotionSample,
  researchGates: PromotionGateResult[],
  stagingGates: PromotionGateResult[],
  limitedGates: PromotionGateResult[]
): PlaybookPromotionTier {
  if (researchGates.every((g) => g.pass)) {
    if (stagingGates.every((g) => g.pass)) {
      if (limitedGates.every((g) => g.pass)) return "limited_live";
      return "staging_qualified";
    }
    return "research";
  }
  return "insufficient";
}

export function evaluatePlaybookPromotion(sample: PlaybookPromotionSample): PlaybookPromotionEval {
  const returns = sample.trades.map((t) => t.return_pts);
  const sessions = new Set(sample.trades.map((t) => t.session_date));
  const conditions = sample.trades
    .map((t) => t.market_condition_bucket)
    .filter((b): b is string => Boolean(b));
  const adverse = adverseSlippageReturns(
    sample.trades,
    PROMOTION_STAGING_THRESHOLDS.adverse_slippage_multiplier
  );

  const researchGates = evaluatePromotionGates(sample, PROMOTION_RESEARCH_THRESHOLDS);
  const stagingGates = evaluatePromotionGates(sample, PROMOTION_STAGING_THRESHOLDS);
  const limitedGates = evaluatePromotionGates(sample, PROMOTION_LIMITED_LIVE_THRESHOLDS);

  return {
    playbook_id: sample.playbook_id,
    tier: tierFromGates(sample, researchGates, stagingGates, limitedGates),
    gates: stagingGates.length > researchGates.length ? stagingGates : researchGates,
    stats: {
      unique_sessions: sessions.size,
      unique_market_conditions: uniqueMarketConditionCount(conditions),
      closed_trades: returns.length,
      mean_return_pts: returns.length
        ? returns.reduce((a, b) => a + b, 0) / returns.length
        : null,
      median_return_pts: median(returns),
      trimmed_mean_return_pts: trimmedMean(returns),
      expectancy_adverse_pts: adverse.length
        ? adverse.reduce((a, b) => a + b, 0) / adverse.length
        : null,
      best_trade_profit_share: bestTradeProfitShare(returns),
      best_session_profit_share: bestSessionProfitShare(sample.trades),
      p5_return_pts: percentile(returns, 0.05),
      walk_forward_positive_windows: walkForwardPositiveWindows(sample.trades),
      counterfactual_comparable_count: sample.counterfactual_comparable_count ?? 0,
    },
  };
}

/** Counterfactual rows are comparable only with matching contract_version + horizon. */
export function isCounterfactualComparableEval(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.contract_version !== 1) return false;
  const horizon = Number(o.counterfactual_horizon_seconds);
  const defaultHorizon = Number(process.env.PLAYBOOK_COUNTERFACTUAL_HORIZON_SEC ?? "900");
  const expected = Number.isFinite(defaultHorizon) && defaultHorizon >= 60 ? defaultHorizon : 900;
  return Number.isFinite(horizon) && Math.floor(horizon) === expected;
}
