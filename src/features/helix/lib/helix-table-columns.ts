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
  /** Column FLOOR (rem) — the grid track's `minmax()` minimum; also the horizontal-scroll floor. */
  width: string;
  /**
   * How eagerly the column grows to absorb leftover desk width (the `fr` weight). Defaults to the
   * numeric `width`, so a column's growth tracks its size. Override when the FLOOR must be large but
   * the content is FIXED-width and shouldn't hog slack — e.g. `time` needs a 9rem floor to fit the
   * full timestamp yet should barely grow, leaving the extra desk space for `signals`.
   */
  growWeight?: number;
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
    hint: "Print time in US Eastern (MM/DD/YYYY - HH:MM)",
    group: "print",
    sortKey: "time",
    density: "essential",
    // Wide enough for the full absolute stamp "07/15/2026 - 11:45" in the monospace tape font
    // (17 glyphs). Was 3.25rem when the cell showed a relative age like "2d"/"11h".
    width: "9rem",
    // The stamp is fixed-width, so keep the growth weight at the OLD 3.25 — the column holds its
    // 9rem floor but yields desktop slack to the columns that benefit (signals stays widest-growing).
    growWeight: 3.25,
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

/**
 * `grid-template-columns` for the tape's CSS grid. Each column becomes `minmax(<width>, <weight>fr)`:
 *
 *  - the fixed `<width>` (rem) is the column FLOOR — on a narrow (mobile) viewport the row can't
 *    shrink columns below it, so the tape scrolls horizontally instead of crushing/decoupling. This
 *    is the per-column equivalent of the old table `min-width` scroll floor (`tableMinWidth`, still
 *    applied to the grid container as the aggregate floor);
 *  - the `<weight>fr` (weight = the same rem number) distributes leftover width proportionally on a
 *    wide desk, so the tape fills edge-to-edge with no right gutter — the same proportions the old
 *    percentage `<colgroup>` produced.
 *
 * WHY grid (not the old `table-layout: fixed` + percentage `<colgroup>`): the header row and every
 * body row consume this SAME template via one CSS custom property, so column geometry is computed
 * once and shared. That makes header↔body misalignment structurally impossible. The table approach
 * resolved the percentage columns inconsistently between `<thead>` and `<tbody>` when a `min-width`
 * forced the table wider than a mobile viewport — measured live at 390px the body cells drifted a
 * full column right of their headers (up to ~136px). A single grid template can't drift.
 */
export function tableGridTemplate(cols: HelixColumnDef[]): string {
  return cols
    .map((c) => {
      const w = parseFloat(c.width);
      const ok = Number.isFinite(w) && w > 0;
      // Degenerate guard (unparseable width) → a sane 3rem floor/weight so the row never emits an
      // invalid track (which would collapse the whole grid), matching the old NaN guard's intent.
      const floor = ok ? c.width : "3rem";
      const gw = c.growWeight;
      const weight = Number.isFinite(gw) && (gw as number) > 0 ? (gw as number) : ok ? w : 3;
      return `minmax(${floor}, ${weight}fr)`;
    })
    .join(" ");
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
