export const INDEX_TICKERS = ["SPY", "QQQ", "IWM", "XLF", "XLE", "XLK", "SMH", "XBI", "GLD", "TLT"] as const;

export const INDEX_SET = new Set<string>([
  ...INDEX_TICKERS,
  "SPX",
  "SPXW",
  "NDX",
  "RUT",
  "VIX",
  "UVXY",
]);

export const INDEX_ETF_PLAYS = ["SPY", "QQQ", "IWM", "XLF", "XLE", "XLK"] as const;

export const SECTOR_WATCH = [
  { key: "technology", label: "Technology" },
  { key: "financial", label: "Financials" },
  { key: "energy", label: "Energy" },
  { key: "healthcare", label: "Healthcare" },
  { key: "consumer", label: "Consumer" },
] as const;

export const MAX_CANDIDATES = 60;
/** Candidate pool: weighted-premium leaders + unusual-flow movers. */
export const CANDIDATE_PREMIUM_SLOTS = 40;
export const CANDIDATE_UNUSUAL_SLOTS = 20;
export const CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS = 30;
/** Floor for 30d avg premium — avoids divide-by-zero on thin history. */
export const CANDIDATE_MIN_BASELINE_PREMIUM = 75_000;
export const MAX_DOSSIER_STOCKS = 60;
/** Top dossiers sent to Claude for play synthesis (not the full ranked pool). */
export const EDITION_SYNTHESIS_POOL = 12;
/** Stock tickers to prefetch option chains for (buffer above 5 final plays). */
export const EDITION_CHAIN_PREFETCH = 12;
export const MIN_STOCK_FLOW_PREMIUM = 100_000;
export const MIN_HOT_CHAIN_PREMIUM = 500_000;
/** Market-wide flow tape — higher limit captures late-session event volume. */
export const MARKET_FLOW_ALERT_LIMIT = 450;
export const DOSSIER_BATCH_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.NH_DOSSIER_BATCH_SIZE ?? 3))
);
export const DOSSIER_FETCH_TIMEOUT_MS = 8000;
export const DOSSIER_INTER_BATCH_MS = 500;

/** Max option entry premium per share — 1 standard contract (100 shares) ≤ $2,000. */
export const MAX_OPTION_PREMIUM_PER_SHARE = 20;
export const MAX_OPTION_COST_PER_CONTRACT = MAX_OPTION_PREMIUM_PER_SHARE * 100;

export const PLAYBOOK_PREMIUM_CAP_LINE = `Entry option premium MUST be ≤ $${MAX_OPTION_PREMIUM_PER_SHARE}/share (≤ $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot contract). If no suitable contract exists under this cap, skip the ticker and substitute the next-ranked candidate.`;
