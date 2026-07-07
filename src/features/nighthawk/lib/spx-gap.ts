import type { MarketWideContext } from "./market-wide";

export type SpxGapContext = {
  prior_close: number;
  session_open: number;
  last_price: number;
  gap_pct: number;
  pattern: "gap_and_go" | "gap_and_trap" | "gap_fill" | "flat_open" | "unknown";
  detail: string;
};

const FLAT_GAP_PCT = 0.2;

export function computeSpxGapContext(
  dailyBars: MarketWideContext["spx_bars"],
  intradayBars: Array<{ o: number; h: number; l: number; c: number }>
): SpxGapContext | null {
  if (dailyBars.length < 2) return null;

  const prior_close = dailyBars.at(-2)!.c;
  if (!prior_close || prior_close <= 0) return null;

  const todayDaily = dailyBars.at(-1);
  const session_open = intradayBars[0]?.o ?? todayDaily?.o;
  const last_price = intradayBars.at(-1)?.c ?? todayDaily?.c;
  if (session_open == null || last_price == null || session_open <= 0) return null;

  const gap_pct = ((session_open - prior_close) / prior_close) * 100;
  const absGap = Math.abs(gap_pct);

  let pattern: SpxGapContext["pattern"] = "unknown";
  let detail = "";

  if (absGap < FLAT_GAP_PCT) {
    pattern = "flat_open";
    detail = `Opened flat (${gap_pct >= 0 ? "+" : ""}${gap_pct.toFixed(2)}% vs prior close ${prior_close.toFixed(2)})`;
  } else if (gap_pct > 0) {
    if (last_price >= session_open && last_price > prior_close) {
      pattern = "gap_and_go";
      detail = `Gap up ${gap_pct.toFixed(2)}% to ${session_open.toFixed(2)} — held above open, last ${last_price.toFixed(2)}`;
    } else if (last_price < session_open) {
      pattern = "gap_and_trap";
      detail = `Gap up ${gap_pct.toFixed(2)}% to ${session_open.toFixed(2)} — faded below open, last ${last_price.toFixed(2)}`;
    } else {
      pattern = "gap_fill";
      detail = `Gap up ${gap_pct.toFixed(2)}% — partial fade, last ${last_price.toFixed(2)} (open ${session_open.toFixed(2)})`;
    }
  } else {
    if (last_price <= session_open && last_price < prior_close) {
      pattern = "gap_and_go";
      detail = `Gap down ${gap_pct.toFixed(2)}% to ${session_open.toFixed(2)} — continued lower, last ${last_price.toFixed(2)}`;
    } else if (last_price > session_open) {
      pattern = "gap_and_trap";
      detail = `Gap down ${gap_pct.toFixed(2)}% to ${session_open.toFixed(2)} — reclaimed open, last ${last_price.toFixed(2)}`;
    } else {
      pattern = "gap_fill";
      detail = `Gap down ${gap_pct.toFixed(2)}% — bounce attempt, last ${last_price.toFixed(2)} (open ${session_open.toFixed(2)})`;
    }
  }

  return {
    prior_close,
    session_open,
    last_price,
    gap_pct,
    pattern,
    detail,
  };
}

export function formatSpxGapContext(gap: SpxGapContext | null): string {
  if (!gap) return "SPX gap context unavailable.";
  const label =
    gap.pattern === "gap_and_go"
      ? "Gap & go"
      : gap.pattern === "gap_and_trap"
        ? "Gap & trap"
        : gap.pattern === "gap_fill"
          ? "Gap fill / fade"
          : gap.pattern === "flat_open"
            ? "Flat open"
            : "Unknown";
  return `${label}: ${gap.detail}`;
}
