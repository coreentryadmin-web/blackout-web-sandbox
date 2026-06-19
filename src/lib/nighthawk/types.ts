export type HuntMode = "day" | "swing" | "leap";

export type PlaybookPlay = {
  rank: number;
  ticker: string;
  direction: string;
  conviction: string;
  play_type: "stock" | "index" | "etf";
  thesis: string;
  key_signal: string;
  entry_range: string;
  target: string;
  stop: string;
  options_play: string;
  /** Per-share option entry premium (must be ≤ $20). */
  entry_premium?: number;
  /** entry_premium × 100 — cost for one contract. */
  entry_cost_per_contract?: number;
  premium_cap_ok?: boolean;
  risk_note?: string;
  score: number;
  flow_streak_days?: number;
  iv_rank?: number;
};

export type PlayExplainRequest = {
  edition_for: string;
  ticker: string;
};

export type PlayExplainResponse = {
  ticker: string;
  rank: number;
  explanation: string;
  cached: boolean;
};

export type NightHawkEdition = {
  available: boolean;
  edition_for: string | null;
  published_at: string | null;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap?: Record<string, unknown> | null;
  plays: PlaybookPlay[];
};

export type AgentFilterValues = Record<string, string | number | boolean>;

export type HuntRequest = {
  mode: HuntMode;
  filters: AgentFilterValues;
};

export type HuntPlay = {
  ticker: string;
  direction: string;
  thesis: string;
  contract: string;
  entry: string;
  target: string;
  stop: string;
  score: number;
  /** Day Trade Agent lifecycle phase. */
  phase?: "CANDIDATE" | "WATCH" | "ACTIONABLE" | "EXPIRED";
  /** Whether play aligns with SPX desk bias when spx_context filter is on. */
  spx_aligned?: boolean;
};

export type HuntResponse = {
  status: "queued" | "complete" | "error";
  mode: HuntMode;
  scanned_at: string;
  message: string;
  plays: HuntPlay[];
  /** Live cross-service context available to hunt agents. */
  platform_context?: {
    spx_price: number | null;
    flow_alerts: number;
    edition_for: string | null;
    edition_plays: number;
    spx_bias?: "bull" | "bear" | "neutral" | null;
  };
  /** Hunt pipeline stats for agent workspaces. */
  scan_meta?: {
    candidates: number;
    duration_ms: number;
  };
};
