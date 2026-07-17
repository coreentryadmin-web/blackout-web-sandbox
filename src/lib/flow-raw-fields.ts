/**
 * Extract per-print chain context from a UW raw alert/print payload.
 * Mirrors the SQL casts in db.ts fetchRecentFlows so SSE rows match REST rows.
 */
import type { MarketFlowAlert } from "@/lib/providers/unusual-whales";

function numFromRaw(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v == null) continue;
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(v)
          ? Number(v)
          : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export type FlowChainFields = {
  fill_price?: number;
  ask_pct?: number;
  underlying_price?: number;
  open_interest?: number;
  implied_volatility?: number;
  otm_pct?: number;
  alert_rule?: string;
};

export function extractChainFieldsFromRaw(
  raw: Record<string, unknown>,
  flow: Pick<MarketFlowAlert, "strike" | "option_type">
): FlowChainFields {
  const fill_price = numFromRaw(raw, "price");
  const ask_pct = numFromRaw(raw, "ask_side_pct");
  const underlying_price = numFromRaw(raw, "underlying_last", "underlying_price", "stock_price");
  const open_interest = numFromRaw(raw, "open_interest", "oi");
  const implied_volatility = numFromRaw(raw, "iv", "implied_volatility");

  let otm_pct: number | undefined;
  if (underlying_price != null && underlying_price > 0 && flow.strike > 0) {
    const opt = flow.option_type.toLowerCase();
    if (opt.startsWith("c") || opt.startsWith("p")) {
      const isCall = opt.startsWith("c");
      otm_pct =
        Math.round(
          ((isCall ? flow.strike - underlying_price : underlying_price - flow.strike) /
            underlying_price) *
            1000
        ) / 10;
    }
  }

  const ruleRaw = String(raw.alert_rule ?? raw.rule_name ?? "").trim();
  return {
    fill_price,
    ask_pct,
    underlying_price,
    open_interest,
    implied_volatility,
    otm_pct,
    alert_rule: ruleRaw || undefined,
  };
}
