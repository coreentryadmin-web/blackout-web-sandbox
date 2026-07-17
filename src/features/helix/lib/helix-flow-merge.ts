import type { FlowAlert } from "@/lib/api";

/** Merge a sparse SSE row with a richer REST row (same print). Prefer non-null chain fields. */
export function mergeFlowAlerts(primary: FlowAlert, fallback?: FlowAlert | null): FlowAlert {
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    fill_price: primary.fill_price ?? fallback.fill_price,
    ask_pct: primary.ask_pct ?? fallback.ask_pct,
    underlying_price: primary.underlying_price ?? fallback.underlying_price,
    open_interest: primary.open_interest ?? fallback.open_interest,
    implied_volatility: primary.implied_volatility ?? fallback.implied_volatility,
    otm_pct: primary.otm_pct ?? fallback.otm_pct,
    alert_rule: primary.alert_rule ?? fallback.alert_rule,
    gex_proximity: primary.gex_proximity ?? fallback.gex_proximity,
    score: primary.score > 0 ? primary.score : fallback.score,
    alerted_at: primary.alerted_at || fallback.alerted_at,
    event_at: primary.event_at ?? fallback.event_at,
    alert_id: primary.alert_id ?? fallback.alert_id,
  };
}

export function findMatchingFlow(alerts: FlowAlert[], incoming: FlowAlert): number {
  const id = incoming.alert_id;
  if (id) {
    const byId = alerts.findIndex((a) => a.alert_id === id);
    if (byId >= 0) return byId;
  }
  const key = `${incoming.ticker}|${incoming.strike}|${incoming.option_type}|${String(incoming.alerted_at ?? "").slice(0, 19)}`;
  return alerts.findIndex(
    (a) => `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at ?? "").slice(0, 19)}` === key
  );
}
