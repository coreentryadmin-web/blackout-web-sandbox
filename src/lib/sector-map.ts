/** Static ticker → GICS-style sector mapping for flow aggregation. */
export const SECTOR_MAP: Record<string, string> = {
  // Indices / ETFs
  SPX: "Indices", SPXW: "Indices", SPY: "Indices", QQQ: "Indices",
  IWM: "Indices", DIA: "Indices", VXX: "Indices", UVXY: "Indices",
  SQQQ: "Indices", TQQQ: "Indices", SPXU: "Indices", UPRO: "Indices",
  // Sector ETFs (map to their own sector)
  XLK: "Tech", XLF: "Financials", XLE: "Energy", XLV: "Healthcare",
  XLI: "Industrials", XLY: "Cons.Disc.", XLP: "Cons.Staples",
  XLU: "Utilities", XLRE: "Real Estate", XLB: "Materials", XLC: "Comm.Svc.",
  // Technology
  NVDA: "Tech", AMD: "Tech", MSFT: "Tech", AAPL: "Tech", META: "Tech",
  GOOGL: "Tech", GOOG: "Tech", AMZN: "Tech", TSM: "Tech", MU: "Tech",
  INTC: "Tech", AVGO: "Tech", QCOM: "Tech", NOW: "Tech", CRM: "Tech",
  PLTR: "Tech", SNOW: "Tech", NET: "Tech", UBER: "Tech", ARM: "Tech",
  SMCI: "Tech", DELL: "Tech", HPE: "Tech", ORCL: "Tech", IBM: "Tech",
  AMAT: "Tech", ASML: "Tech", KLAC: "Tech", LRCX: "Tech", MRVL: "Tech",
  MSTR: "Tech", COIN: "Tech", HOOD: "Tech", IONQ: "Tech", RGTI: "Tech",
  // Financials
  JPM: "Financials", GS: "Financials", BAC: "Financials", MS: "Financials",
  WFC: "Financials", C: "Financials", BLK: "Financials", V: "Financials",
  MA: "Financials", AXP: "Financials", COF: "Financials", SCHW: "Financials",
  SOFI: "Financials", NU: "Financials", AFRM: "Financials",
  // Healthcare
  LLY: "Healthcare", JNJ: "Healthcare", UNH: "Healthcare", ABBV: "Healthcare",
  MRK: "Healthcare", PFE: "Healthcare", TMO: "Healthcare", GILD: "Healthcare",
  MRNA: "Healthcare", NVAX: "Healthcare", ISRG: "Healthcare", DXCM: "Healthcare",
  // Energy
  XOM: "Energy", CVX: "Energy", COP: "Energy", OXY: "Energy",
  SLB: "Energy", HAL: "Energy", MPC: "Energy", PSX: "Energy", VLO: "Energy",
  // Consumer Discretionary
  TSLA: "Cons.Disc.", NKE: "Cons.Disc.", MCD: "Cons.Disc.", SBUX: "Cons.Disc.",
  TGT: "Cons.Disc.", HD: "Cons.Disc.", LOW: "Cons.Disc.", COST: "Cons.Disc.",
  BABA: "Cons.Disc.", JD: "Cons.Disc.", MELI: "Cons.Disc.",
  // Consumer Staples
  WMT: "Cons.Staples", PG: "Cons.Staples", KO: "Cons.Staples", PEP: "Cons.Staples",
  // Industrials
  CAT: "Industrials", RTX: "Industrials", BA: "Industrials", HON: "Industrials",
  LMT: "Industrials", GE: "Industrials", DE: "Industrials", UNP: "Industrials",
  NOC: "Industrials", GD: "Industrials",
  // Communication Services
  NFLX: "Comm.Svc.", DIS: "Comm.Svc.", T: "Comm.Svc.", VZ: "Comm.Svc.",
  CMCSA: "Comm.Svc.", EA: "Comm.Svc.", RBLX: "Comm.Svc.", SNAP: "Comm.Svc.",
  SPOT: "Comm.Svc.", PINS: "Comm.Svc.",
  // Utilities
  NEE: "Utilities", DUK: "Utilities", SO: "Utilities",
  // Materials
  FCX: "Materials", NEM: "Materials", CLF: "Materials",
};

export const SECTOR_ORDER = [
  "Tech", "Financials", "Indices", "Cons.Disc.", "Healthcare",
  "Energy", "Comm.Svc.", "Industrials", "Cons.Staples", "Materials", "Utilities", "Real Estate",
];

export function getSector(ticker: string): string {
  return SECTOR_MAP[ticker.toUpperCase()] ?? "Other";
}
