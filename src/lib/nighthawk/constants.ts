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

export const MAX_CANDIDATES = 20;
export const MAX_DOSSIER_STOCKS = 5;
export const MIN_STOCK_FLOW_PREMIUM = 100_000;
export const MIN_HOT_CHAIN_PREMIUM = 500_000;
export const DOSSIER_BATCH_SIZE = 4;

/** Max option entry premium per share — 1 standard contract (100 shares) ≤ $2,000. */
export const MAX_OPTION_PREMIUM_PER_SHARE = 20;
export const MAX_OPTION_COST_PER_CONTRACT = MAX_OPTION_PREMIUM_PER_SHARE * 100;

export const PLAYBOOK_PREMIUM_CAP_LINE = `Entry option premium MUST be ≤ $${MAX_OPTION_PREMIUM_PER_SHARE}/share (≤ $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot contract). If no suitable contract exists under this cap, skip the ticker and substitute the next-ranked candidate.`;
