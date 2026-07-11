import type { HelixFlowSortKey } from "@/features/helix/lib/helix-flow-format";

/** Column visibility — user picks how much context fits their monitor. */
export type HelixTableDensity = "essential" | "standard" | "full";

export type HelixColumnGroup = "print" | "contract" | "notional" | "chain" | "intel";

export type HelixColumnDef = {
  id: string;
  label: string;
  /** Short label for narrow viewports */
  shortLabel?: string;
  hint: string;
  group: HelixColumnGroup;
  sortKey?: HelixFlowSortKey;
  align?: "left" | "right";
  density: HelixTableDensity;
  /** Fixed width — keeps header/body columns aligned (table-layout: fixed) */
  width: string;
};

const GROUP_LABELS: Record<HelixColumnGroup, string> = {
  print: "Print",
  contract: "Contract",
  notional: "Notional",
  chain: "Chain",
  intel: "Intel",
};

/** Institutional tape columns — ordered for scan path: when → what → how big → context → why. */
export const HELIX_TABLE_COLUMNS: HelixColumnDef[] = [
  {
    id: "time",
    label: "Time",
    hint: "Seconds since the print hit the tape",
    group: "print",
    sortKey: "time",
    density: "essential",
    width: "3.25rem",
  },
  {
    id: "ticker",
    label: "Symbol",
    shortLabel: "Sym",
    hint: "Underlying ticker — click for ticker drawer",
    group: "print",
    sortKey: "ticker",
    density: "essential",
    width: "4.5rem",
  },
  {
    id: "side",
    label: "Side",
    hint: "Call or put leg",
    group: "contract",
    density: "essential",
    width: "3rem",
  },
  {
    id: "expiry",
    label: "Expiry",
    hint: "Contract expiration (ET)",
    group: "contract",
    sortKey: "expiry",
    density: "essential",
    width: "5rem",
  },
  {
    id: "strike",
    label: "Strike",
    hint: "Strike price with side suffix",
    group: "contract",
    sortKey: "strike",
    align: "right",
    density: "essential",
    width: "5.25rem",
  },
  {
    id: "premium",
    label: "Premium",
    shortLabel: "Prem",
    hint: "Total dollars paid for the print",
    group: "notional",
    sortKey: "premium",
    align: "right",
    density: "essential",
    width: "6.5rem",
  },
  {
    id: "fill",
    label: "Fill",
    hint: "Per-contract fill price",
    group: "notional",
    align: "right",
    density: "standard",
    width: "4rem",
  },
  {
    id: "dte",
    label: "DTE",
    hint: "Calendar days to expiration (ET)",
    group: "chain",
    sortKey: "dte",
    align: "right",
    density: "essential",
    width: "2.75rem",
  },
  {
    id: "spot",
    label: "Spot",
    hint: "Underlying price at print",
    group: "chain",
    align: "right",
    density: "full",
    width: "5.5rem",
  },
  {
    id: "ask",
    label: "Ask%",
    hint: "Percent of premium paid at or above ask",
    group: "chain",
    align: "right",
    density: "full",
    width: "3.5rem",
  },
  {
    id: "oi",
    label: "OI",
    hint: "Open interest on the contract",
    group: "chain",
    align: "right",
    density: "standard",
    width: "4rem",
  },
  {
    id: "iv",
    label: "IV",
    hint: "Implied volatility at print",
    group: "chain",
    align: "right",
    density: "full",
    width: "3.25rem",
  },
  {
    id: "otm",
    label: "OTM",
    hint: "Percent out of / in the money",
    group: "chain",
    align: "right",
    density: "full",
    width: "4.5rem",
  },
  {
    id: "rule",
    label: "Rule",
    hint: "UW alert rule that flagged the print",
    group: "intel",
    density: "standard",
    width: "5rem",
  },
  {
    id: "score",
    label: "Score",
    shortLabel: "Sc",
    hint: "Blackout conviction score",
    group: "intel",
    sortKey: "score",
    align: "right",
    density: "full",
    width: "3.25rem",
  },
  {
    id: "signals",
    label: "Signals",
    hint: "Stack, whale, 0DTE, GEX proximity, and more",
    group: "intel",
    density: "essential",
    width: "8.5rem",
  },
];

const DENSITY_RANK: Record<HelixTableDensity, number> = {
  essential: 0,
  standard: 1,
  full: 2,
};

export function columnsForDensity(density: HelixTableDensity): HelixColumnDef[] {
  const max = DENSITY_RANK[density];
  return HELIX_TABLE_COLUMNS.filter((c) => DENSITY_RANK[c.density] <= max);
}

export function tableMinWidth(cols: HelixColumnDef[]): string {
  const rem = cols.reduce((sum, c) => sum + parseFloat(c.width), 0);
  return `${rem}rem`;
}

/** First column id in each group — used for vertical group dividers. */
export function groupStartIds(cols: HelixColumnDef[]): Set<string> {
  const starts = new Set<string>();
  let prev: HelixColumnGroup | null = null;
  for (const col of cols) {
    if (col.group !== prev) starts.add(col.id);
    prev = col.group;
  }
  return starts;
}
export function groupHeaderSpans(cols: HelixColumnDef[]): { group: HelixColumnGroup; label: string; span: number }[] {
  const spans: { group: HelixColumnGroup; label: string; span: number }[] = [];
  for (const col of cols) {
    const last = spans[spans.length - 1];
    if (last?.group === col.group) last.span += 1;
    else spans.push({ group: col.group, label: GROUP_LABELS[col.group], span: 1 });
  }
  return spans;
}

export const HELIX_INDEX_TICKERS = ["SPX", "SPY", "QQQ", "IWM", "VIX", "NDX"] as const;

export type HelixDteFilter = "all" | "0dte" | "week" | "month+";

export function matchesDteFilter(dte: number, filter: HelixDteFilter): boolean {
  switch (filter) {
    case "0dte":
      return dte === 0;
    case "week":
      return dte >= 0 && dte <= 7;
    case "month+":
      return dte > 7;
    default:
      return true;
  }
}
