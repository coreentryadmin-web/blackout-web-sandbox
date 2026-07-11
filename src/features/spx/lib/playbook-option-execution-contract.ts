/**
 * Option execution simulator — explicit contract tiers for SPX 0DTE research.
 *
 * **lite_v1 (shipped):** adverse half-spread + slippage bps on mid; greeks lite path.
 * **full_v2 (planned):** per-trade quote reconciliation, partial fills, delay model.
 */
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

export type OptionSimulatorTier = "lite_v1" | "full_v2";

/** Full 0DTE execution model field checklist — documents what lite_v1 omits. */
export type OptionQuoteSnapshot = {
  expiration: string | null;
  strike: number | null;
  option_type: "call" | "put" | null;
  contract_ticker: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread_pct: number | null;
  quote_timestamp_ms: number | null;
  underlying_timestamp_ms: number | null;
  underlying_price: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  implied_volatility: number | null;
  volume: number | null;
  open_interest: number | null;
};

export type OptionFillAssumption = "adverse_half_spread_plus_bps" | "mid" | "bid_ask_walk";

export type OptionExecutionSimContract = {
  simulator_tier: OptionSimulatorTier;
  /** Human-readable — not suitable for limited-live capital deployment. */
  realism: "research_lite" | "production_grade";
  fill_assumption: OptionFillAssumption;
  entry_delay_ms: number;
  exit_delay_ms: number;
  partial_fill_policy: "all_or_nothing" | "pro_rata" | null;
  fees_per_contract_usd: number | null;
  stale_quote_rejected: boolean;
  stale_quote_max_age_sec: number | null;
  quote: OptionQuoteSnapshot;
  assumed_fill: number | null;
  exit_assumed_fill: number | null;
  slippage_pts: number | null;
  half_spread_pts: number | null;
  round_trip_cost_pts: number | null;
  /** Fields required for full_v2 but absent in lite_v1. */
  missing_for_full_tier: readonly string[];
};

export function optionQuoteMaxAgeSec(): number {
  const n = Number(process.env.PLAYBOOK_OPTION_QUOTE_MAX_AGE_SEC ?? "15");
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function optionSimEntryDelayMs(): number {
  const n = Number(process.env.PLAYBOOK_OPTION_ENTRY_DELAY_MS ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function optionSimExitDelayMs(): number {
  const n = Number(process.env.PLAYBOOK_OPTION_EXIT_DELAY_MS ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function optionFeesPerContractUsd(): number | null {
  const raw = process.env.PLAYBOOK_OPTION_FEES_PER_CONTRACT_USD;
  if (raw == null || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const FULL_TIER_REQUIRED: readonly (keyof OptionQuoteSnapshot | "fees" | "partial_fill" | "delay")[] = [
  "expiration",
  "strike",
  "option_type",
  "bid",
  "ask",
  "mid",
  "spread_pct",
  "quote_timestamp_ms",
  "underlying_timestamp_ms",
  "delta",
  "gamma",
  "theta",
  "implied_volatility",
  "volume",
  "open_interest",
];

export function missingFieldsForFullTier(quote: OptionQuoteSnapshot): string[] {
  const missing: string[] = [];
  for (const key of FULL_TIER_REQUIRED) {
    if (key === "fees" || key === "partial_fill" || key === "delay") continue;
    const v = quote[key as keyof OptionQuoteSnapshot];
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) {
      missing.push(key);
    }
  }
  if (optionFeesPerContractUsd() == null) missing.push("fees_per_contract_usd");
  return missing;
}

export function buildOptionQuoteSnapshot(
  ticket: OptionTicket,
  desk: Pick<SpxDeskPayload, "price" | "polled_at" | "as_of">,
  quoteAsOfMs?: number | null
): OptionQuoteSnapshot {
  const deskTs = desk.polled_at ?? desk.as_of;
  const underlyingMs = deskTs ? new Date(deskTs).getTime() : null;
  return {
    expiration: ticket.expiration_date ?? null,
    strike: ticket.strike ?? null,
    option_type: ticket.option_type ?? null,
    contract_ticker: ticket.ticker ?? null,
    bid: ticket.bid,
    ask: ticket.ask,
    mid: ticket.mid,
    spread_pct: ticket.spread_pct,
    quote_timestamp_ms: quoteAsOfMs ?? underlyingMs,
    underlying_timestamp_ms: underlyingMs,
    underlying_price: desk.price ?? null,
    delta: ticket.delta,
    gamma: ticket.gamma ?? null,
    theta: ticket.theta ?? null,
    implied_volatility: ticket.implied_volatility ?? null,
    volume: ticket.volume ?? null,
    open_interest: ticket.open_interest,
  };
}

export function isOptionQuoteStale(
  quote: OptionQuoteSnapshot,
  nowMs = Date.now()
): boolean {
  if (quote.quote_timestamp_ms == null) return true;
  const ageSec = (nowMs - quote.quote_timestamp_ms) / 1000;
  return ageSec > optionQuoteMaxAgeSec();
}

export function buildLiteExecutionSimContract(input: {
  ticket: OptionTicket;
  desk: Pick<SpxDeskPayload, "price" | "polled_at" | "as_of">;
  direction: SpxPlayDirection;
  assumed_fill: number;
  exit_assumed_fill: number | null;
  slippage_pts: number;
  half_spread_pts: number;
  round_trip_cost_pts: number | null;
  quote_as_of_ms?: number | null;
}): OptionExecutionSimContract {
  const quote = buildOptionQuoteSnapshot(input.ticket, input.desk, input.quote_as_of_ms);
  const stale = isOptionQuoteStale(quote);
  return {
    simulator_tier: "lite_v1",
    realism: "research_lite",
    fill_assumption: "adverse_half_spread_plus_bps",
    entry_delay_ms: optionSimEntryDelayMs(),
    exit_delay_ms: optionSimExitDelayMs(),
    partial_fill_policy: "all_or_nothing",
    fees_per_contract_usd: optionFeesPerContractUsd(),
    stale_quote_rejected: stale,
    stale_quote_max_age_sec: optionQuoteMaxAgeSec(),
    quote,
    assumed_fill: stale ? null : input.assumed_fill,
    exit_assumed_fill: stale ? null : input.exit_assumed_fill,
    slippage_pts: input.slippage_pts,
    half_spread_pts: input.half_spread_pts,
    round_trip_cost_pts: stale ? null : input.round_trip_cost_pts,
    missing_for_full_tier: missingFieldsForFullTier(quote),
  };
}
