/**
 * Playbook promotion tiers — session-aware statistical gates for 0DTE research.
 *
 * Trade count alone is insufficient: correlated same-session triggers must not
 * inflate confidence. Unit of confidence includes **sessions** and **market conditions**.
 */

export type PlaybookPromotionTier =
  | "insufficient"
  | "research"
  | "staging_qualified"
  | "limited_live"
  | "production";

export type PlaybookPromotionThresholds = {
  /** Minimum triggered instances (OOS). */
  min_triggers: number;
  /** Opens with execution_sim / cost model attached. */
  min_simulated_trades: number;
  /** Distinct session_date count — primary independence unit. */
  min_sessions: number;
  /** Distinct vix×gamma×regime buckets at trigger. */
  min_unique_market_conditions: number;
  /** Closed trades with cost-adjusted return for expectancy gates. */
  min_closed_trades: number;
  /** Best single trade cannot exceed this share of gross profit. */
  max_best_trade_profit_share: number;
  /** Best session cannot exceed this share of gross profit. */
  max_best_session_profit_share: number;
  /** Extra slippage stress multiplier on round-trip cost (adverse fill test). */
  adverse_slippage_multiplier: number;
  /** Walk-forward: min windows (of 3 chronological thirds) with positive mean. */
  walk_forward_min_positive_windows: number;
  /** 5th percentile return floor (pts) — tail loss bound. */
  p5_return_floor_pts: number;
};

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Research — accumulate OOS shadow + simulated opens. */
export const PROMOTION_RESEARCH_THRESHOLDS: PlaybookPromotionThresholds = {
  min_triggers: Math.floor(envNum("PLAYBOOK_PROMO_MIN_TRIGGERS", 30)),
  min_simulated_trades: Math.floor(envNum("PLAYBOOK_PROMO_MIN_SIM_TRADES", 20)),
  min_sessions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_SESSIONS_RESEARCH", 8)),
  min_unique_market_conditions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_CONDITIONS_RESEARCH", 3)),
  min_closed_trades: 0,
  max_best_trade_profit_share: 1,
  max_best_session_profit_share: 1,
  adverse_slippage_multiplier: 1,
  walk_forward_min_positive_windows: 0,
  p5_return_floor_pts: -Infinity,
};

/** Staging-qualified — cost-adjusted expectancy with robustness gates. */
export const PROMOTION_STAGING_THRESHOLDS: PlaybookPromotionThresholds = {
  min_triggers: Math.floor(envNum("PLAYBOOK_PROMO_MIN_TRIGGERS", 30)),
  min_simulated_trades: Math.floor(envNum("PLAYBOOK_PROMO_MIN_SIM_TRADES", 20)),
  min_sessions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_SESSIONS_STAGING", 15)),
  min_unique_market_conditions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_CONDITIONS_STAGING", 5)),
  min_closed_trades: Math.floor(envNum("PLAYBOOK_PROMO_MIN_CLOSED_STAGING", 50)),
  max_best_trade_profit_share: envNum("PLAYBOOK_PROMO_MAX_BEST_TRADE_SHARE", 0.3),
  max_best_session_profit_share: envNum("PLAYBOOK_PROMO_MAX_BEST_SESSION_SHARE", 0.4),
  adverse_slippage_multiplier: envNum("PLAYBOOK_PROMO_ADVERSE_SLIPPAGE_MULT", 1.5),
  walk_forward_min_positive_windows: Math.floor(envNum("PLAYBOOK_PROMO_WALK_FORWARD_MIN", 2)),
  p5_return_floor_pts: envNum("PLAYBOOK_PROMO_P5_FLOOR_PTS", -12),
};

/** Limited-live — staging gates + execution full_v2 + risk governor (enforced elsewhere). */
export const PROMOTION_LIMITED_LIVE_THRESHOLDS: PlaybookPromotionThresholds = {
  ...PROMOTION_STAGING_THRESHOLDS,
  min_closed_trades: Math.floor(envNum("PLAYBOOK_PROMO_MIN_CLOSED_LIMITED", 75)),
  min_sessions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_SESSIONS_LIMITED", 20)),
  min_unique_market_conditions: Math.floor(envNum("PLAYBOOK_PROMO_MIN_CONDITIONS_LIMITED", 6)),
  max_best_trade_profit_share: envNum("PLAYBOOK_PROMO_MAX_BEST_TRADE_SHARE_LL", 0.25),
  max_best_session_profit_share: envNum("PLAYBOOK_PROMO_MAX_BEST_SESSION_SHARE_LL", 0.35),
  p5_return_floor_pts: envNum("PLAYBOOK_PROMO_P5_FLOOR_PTS_LL", -10),
};

export const PROMOTION_TIER_ORDER: readonly PlaybookPromotionTier[] = [
  "insufficient",
  "research",
  "staging_qualified",
  "limited_live",
  "production",
];

export function thresholdsForTier(tier: PlaybookPromotionTier): PlaybookPromotionThresholds | null {
  switch (tier) {
    case "research":
      return PROMOTION_RESEARCH_THRESHOLDS;
    case "staging_qualified":
      return PROMOTION_STAGING_THRESHOLDS;
    case "limited_live":
    case "production":
      return PROMOTION_LIMITED_LIVE_THRESHOLDS;
    default:
      return null;
  }
}
