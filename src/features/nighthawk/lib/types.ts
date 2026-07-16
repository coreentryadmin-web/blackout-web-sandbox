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
  /** Optional so a degraded/legacy source with no real score renders "—", never a fabricated 0. */
  score?: number;
  flow_streak_days?: number;
  iv_rank?: number;
  /** PR-N4: true when the morning confirmation INVALIDATED this play and the one-way pull
   *  latch engaged (nighthawk_play_outcomes.pulled, merged at read time by
   *  pull-overlay.ts). A pulled play stays visible at its published rank but must be
   *  presented as PULLED (non-actionable) with its reason — never hidden, never deleted. */
  pulled?: boolean;
  /** Member-facing reason the play was pulled (the verdict's evidence sentence). */
  pulled_reason?: string;
  /** True when a play did NOT fully clear the publish-time sanity gates but was promoted
   *  into the edition anyway because the pipeline would otherwise publish zero plays.
   *  These plays carry gate_warnings explaining which gates failed and by how much.
   *  The UI must badge them so members know the entry may need extra validation. */
  gate_promoted?: boolean;
  /** Human-readable gate-failure reasons (one per failed gate). Only present when
   *  gate_promoted is true. */
  gate_warnings?: string[];
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
  /** True when there is real published content to show — either ranked plays OR a market recap.
   *  A recap-only edition (plays:[] but a published recap) is `available: true` so the UI renders
   *  the recap instead of the "awaiting close" empty state. */
  available: boolean;
  edition_for: string | null;
  published_at: string | null;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap?: Record<string, unknown> | null;
  plays: PlaybookPlay[];
  /** True when this edition published a market recap but no ranked plays survived the funnel.
   *  Lets the UI show a recap-only state distinct from both "5 plays" and "awaiting close". */
  recap_only?: boolean;
  /** True when this edition came from a degraded/legacy source (e.g. the BlackOut intel engine
   *  fallback) rather than the first-class published pipeline. The UI must NOT present a degraded
   *  edition as a fresh "Edition live" recap — show a legacy/degraded notice instead. */
  degraded?: boolean;
  /** True when the served edition is an OLDER stored edition returned because the requested
   *  session's edition isn't published yet (the latest-fallback path). The UI must NOT assert
   *  "Edition live" — it should show "Showing {served_for} edition — tonight's not published yet". */
  stale?: boolean;
  /** The edition_for date that was actually served when `stale` is true (the older edition's date). */
  served_for?: string | null;
  /** True when prior generated plays are intentionally kept visible until their session closes. */
  carry_until_close?: boolean;
};

export type PlayConfirmStatus = "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED";

export type PlayMorningStatus = {
  rank: number;
  ticker: string;
  direction: string;
  status: PlayConfirmStatus;
  reason: string;
};

export type NightHawkPlayStatusResponse = {
  available: boolean;
  edition_for?: string;
  date?: string;
  reason?: string;
  checked_at?: string;
  spx_premarket?: number | null;
  overnight_gap_pts?: number | null;
  regime?: string | null;
  gex_bias?: string | null;
  plays?: PlayMorningStatus[];
  summary?: { confirmed: number; degraded: number; invalidated: number };
};

/** PR-N2: one grading-methodology segment of the record, as served to members. The two
 *  segments are reported side by side and never aggregated — see analytics.ts's
 *  NighthawkRecordSegment (this is its rounded wire shape). */
export type NightHawkRecordSegmentWire = {
  methodology: string;
  label: string;
  resolved: number;
  scoreable: number;
  wins: number;
  losses: number;
  opens: number;
  ambiguous: number;
  unfilled: number;
  pulled: number;
  stop_data_unavailable: number;
  /** null when nothing is scoreable — never a fake 0%. */
  win_rate_pct: number | null;
  avg_return_pct: number | null;
  /** scoreable < LOW_N_THRESHOLD — the UI must badge this segment's ratios. */
  low_n: boolean;
};

export type NightHawkRecordResponse = {
  available: boolean;
  window_days: number;
  total_resolved: number;
  pending_count: number;
  /** PR-N2: headline ratios cover CURRENT-methodology scoreable rows only. */
  win_rate_pct: number;
  profitable_rate_pct: number;
  avg_return_pct: number;
  /** PR-N2 additive fields — optional so a stale SWR cache of the old payload still
   *  type-checks; the strip falls back to the legacy rendering when absent. */
  methodology?: string;
  unfilled_count?: number;
  pulled_count?: number;
  stop_data_unavailable_count?: number;
  segments?: { current: NightHawkRecordSegmentWire; legacy: NightHawkRecordSegmentWire };
  by_conviction: Array<{ conviction: string; n: number; win_rate_pct: number; low_n?: boolean }>;
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
  /** Optional — propagates an unknown score (e.g. from a degraded source) as undefined → "—",
   *  never a fabricated 0. */
  score?: number;
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
