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

/**
 * Leveraged / inverse ETFs and VIX ETPs — excluded from single-name candidate
 * discovery (audit MEDIUM: no security-type filter existed, so a 3× semi ETF with
 * unusual option premium became a full "stock" candidate and was scored by machinery
 * built for single names — fundamentals/insider/congress all N/A). Index products
 * proper live in INDEX_SET; this set covers the geared/derivative wrappers.
 */
export const LEVERAGED_ETP_SET = new Set<string>([
  "TQQQ", "SQQQ", "SOXL", "SOXS", "SPXL", "SPXS", "SPXU", "UPRO", "SDS", "SSO",
  "QLD", "QID", "TNA", "TZA", "FAS", "FAZ", "LABU", "LABD", "TECL", "TECS",
  "NUGT", "DUST", "JNUG", "JDST", "YINN", "YANG", "ERX", "ERY", "DRN", "DRV",
  "TMF", "TMV", "BOIL", "KOLD", "UCO", "SCO", "DPST", "WEBL", "WEBS", "BULZ", "BERZ",
  "UVXY", "SVXY", "VXX", "UVIX", "SVIX", "VIXY", "VIXM",
  "TSLL", "TSLQ", "TSLS", "NVDL", "NVDD", "NVDS", "MSTU", "MSTZ", "MSTX", "CONL", "AMDL", "AMZU", "GGLL", "METU", "FBL",
]);

/** Minimum underlying price for a single-name candidate (penny/garbage-runner floor).
 *  Raised from $2 to $5 — $2-$4 names have unreliable options chains and whipsaw. */
export const CANDIDATE_MIN_UNDERLYING_PRICE = 5;

export const SECTOR_WATCH = [
  { key: "technology", label: "Technology" },
  { key: "financial", label: "Financials" },
  { key: "energy", label: "Energy" },
  { key: "healthcare", label: "Healthcare" },
  { key: "consumer", label: "Consumer" },
] as const;

// Lowered 60 → 40 to cut the dossier-stage UW fan-out: 60 candidates × multiple UW calls
// each was tripping the rate-limit circuit breaker. Only the top 12 reach synthesis anyway.
export const MAX_CANDIDATES = 40;
/** Candidate pool: weighted-premium leaders + unusual-flow movers. */
export const CANDIDATE_PREMIUM_SLOTS = 28;
export const CANDIDATE_UNUSUAL_SLOTS = 12;
export const CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS = 30;
/** Floor for 30d avg premium — avoids divide-by-zero on thin history. */
export const CANDIDATE_MIN_BASELINE_PREMIUM = 75_000;
export const MAX_DOSSIER_STOCKS = 40;
/** Top dossiers sent to Claude for play synthesis (not the full ranked pool). */
export const EDITION_SYNTHESIS_POOL = 18;
/** Final play count shown in the UI (PlaybookBoard renders 5 slots). */
export const EDITION_TARGET_PLAYS = 5;
/** Minimum plays before ops pages on a thin edition — backfill from ranked pool when below. */
export const EDITION_MIN_PUBLISH_PLAYS = 3;
/** Overshoot sent through synthesis + critic — critic cuts weak plays with no backfill. */
export const EDITION_SYNTHESIS_OVERSHOOT = 7;
/** Stock tickers to prefetch option chains for (buffer above 5 final plays). */
export const EDITION_CHAIN_PREFETCH = 18;
export const MIN_STOCK_FLOW_PREMIUM = 100_000;
export const MIN_HOT_CHAIN_PREMIUM = 500_000;
/** Market-wide flow tape — higher limit captures late-session event volume. */
export const MARKET_FLOW_ALERT_LIMIT = 450;
export const DOSSIER_BATCH_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.NH_DOSSIER_BATCH_SIZE ?? 3))
);
export const DOSSIER_FETCH_TIMEOUT_MS = 8000;
export const DOSSIER_INTER_BATCH_MS = 800;

/** Max option entry premium per share — 1 standard contract (100 shares) ≤ $3,500.
 *  Raised from $20 to $35 (PR-N15): the $20 cap blocked every ATM option on stocks above
 *  ~$250, silently eliminating the strongest institutional-flow names from the playbook. */
export const MAX_OPTION_PREMIUM_PER_SHARE = 35;
export const MAX_OPTION_COST_PER_CONTRACT = MAX_OPTION_PREMIUM_PER_SHARE * 100;

export const PLAYBOOK_PREMIUM_CAP_LINE = `Entry option premium MUST be ≤ $${MAX_OPTION_PREMIUM_PER_SHARE}/share (≤ $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot contract). If no suitable contract exists under this cap, skip the ticker and substitute the next-ranked candidate.`;

/**
 * NUMERIC-GROUNDING enforcement (data-correctness audit P0). When ON (default), a play that fails a
 * HARD grounding check (off-chain/illiquid strike, null/way-off premium vs the confirmed chain ask)
 * is DROPPED from the edition; SOFT issues (flow/level/prose/PT divergence) keep the play but
 * strip/flag the number. The grounding CHECKS always run and always log a summary regardless of this
 * flag — the flag only controls whether HARD failures actually drop the play, so it can be turned OFF
 * (NIGHTHAWK_GROUNDING_ENFORCE=0) for one run to observe what WOULD be dropped without changing output.
 * Deploy-risk knob: this is what changes what publishes, so it is env-overridable for instant rollback.
 */
export const GROUNDING_ENFORCE =
  (process.env.NIGHTHAWK_GROUNDING_ENFORCE ?? "1").trim() !== "0";
