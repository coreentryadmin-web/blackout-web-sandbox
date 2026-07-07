import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { FlowRow } from "@/lib/db";
import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";

/** Product areas on the BlackOut desk — each can read any other's snapshot via `marketPlatform`. */
export type PlatformServiceId = "spx" | "flows" | "nighthawk" | "largo";

export type SpxDeskSummary = {
  as_of: string;
  market_open: boolean;
  market_label: string;
  price: number;
  change_pct: number | null;
  vix: number | null;
  vwap: number | null;
  above_vwap: boolean | null;
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  ema20: number | null;
  ema50: number | null;
  gamma_flip: number | null;
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_regime: string | null;
  gex_walls: unknown;
  flow_0dte_net: number | null;
  tide_bias: string | null;
  tide_net: number | null;
  nope: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;
  uw_iv_rank: number | null;
  regime: string | null;
  levels: unknown;
  dark_pool: unknown;
  spx_flows: unknown;
  unified_tape: unknown;
  net_prem_ticks: unknown;
  news_headlines: unknown;
  macro_events: unknown;
  sector_heat: unknown;
  leader_stocks: unknown;
  oi_changes: unknown;
  iv_term_structure: unknown;
  vix_term: unknown;
  // High-value desk fields that the summary used to drop — now surfaced to every
  // SPX tool (get_spx_structure / get_market_context / get_platform_snapshot) at
  // zero extra API cost (Largo audit cross-tool fix).
  greek_exposure: unknown;
  market_breadth: unknown;
  mag7_greek_flow: unknown;
  macro_indicators: unknown;
  strike_stacks: FlowStrikeStack[];
};

export type FlowTapeSummary = {
  count: number;
  total_premium: number;
  top_tickers: Array<{ ticker: string; premium: number; count: number }>;
  recent: FlowRow[];
};

export type NightHawkEditionSummary = {
  available: boolean;
  edition_for: string | null;
  published_at: string | null;
  recap_headline: string | null;
  play_count: number;
  top_tickers: string[];
};

export type PlatformSnapshot = {
  as_of: string;
  spx?: SpxDeskSummary | null;
  flows?: FlowTapeSummary | null;
  nighthawk?: NightHawkEditionSummary | null;
  /** Full edition when explicitly requested. */
  nighthawk_edition?: NightHawkEdition | null;
};

export type { SpxDeskPayload, NightHawkEdition, FlowRow, FlowStrikeStack };
