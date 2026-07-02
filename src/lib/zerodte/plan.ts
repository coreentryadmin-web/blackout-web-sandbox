// Contract plan for a 0DTE find — the "at what premium do I enter, when do I exit"
// layer. Everything here is derived from REAL observed numbers (what the flow
// actually paid, the contract's live quote, chart structure already computed) plus
// FIXED risk rules — never a predicted price. Pure functions only (unit-testable,
// dependency-free leaf); the scan does the fetching.
//
// The plan is also what the ledger GRADES: after the session, the option's own
// minute bars decide whether the printed plan doubled, stopped, or timed out —
// so the board's "plays" carry a measured track record, same standard as the
// engines. Honesty rule: a plan prints only when a real quote or real fill
// exists; missing data → no plan, never a guess.

/** Fixed risk discipline for 0DTE longs-premium plays. Rules, not predictions. */
export const PLAN_RULES = {
  /** Cut the position when premium loses half its entry value. */
  stop_pct: -50,
  /** Take (at least a trim) when premium doubles. */
  target_pct: 100,
  /** Hard time stop — 0DTE theta collapse into the close; ET minutes (15:30). */
  time_stop_et_minutes: 15 * 60 + 30,
} as const;

/** How far above the flow's average fill the mark can sit before the move is
 *  considered "already happened" — the user's explicit skip rule. */
const CHASE_PCT = 35;

export type EntryStatus =
  | "IN_RANGE" // mark at/below the flow's fill (or within tolerance) — enterable
  | "MOVED" // premium already ran ≥CHASE_PCT past the flow's fill — skip, don't chase
  | "CHEAPER" // quoted BELOW what the flow paid — better entry than the smart money got
  | "NO_QUOTE"; // no live quote — evidence only, no plan

export type ContractPlan = {
  /** OCC contract this plan is for (top strike on the dominant side). */
  occ: string;
  /** Premium-weighted average per-contract fill the tape actually paid. */
  flow_avg_fill: number | null;
  /** Live quote at plan time. */
  bid: number | null;
  ask: number | null;
  mark: number | null;
  /** Enter at or below this premium (flow's fill; falls back to mark when no fill). */
  entry_max: number | null;
  /** mark vs flow fill, % — positive = paying up vs the smart money. */
  vs_flow_pct: number | null;
  entry_status: EntryStatus;
  /** Premium exits from PLAN_RULES applied to entry_max. */
  stop_premium: number | null;
  target_premium: number | null;
  time_stop_et: string;
  /** Underlying anchors from real chart structure (nearest levels), null when unknown. */
  underlying_target: number | null;
  underlying_invalid: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the plan for a find's top-strike contract. `flowAvgFill` is the premium-
 * weighted per-contract price the tape paid; quote is the live snapshot. Chart
 * levels come from the dossier tech card (already computed).
 */
export function buildContractPlan(input: {
  occ: string;
  direction: "long" | "short";
  price: number | null;
  flowAvgFill: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  keySupports: number[];
  keyResistances: number[];
  vwap: number | null;
}): ContractPlan {
  const { occ, direction, price, flowAvgFill, bid, ask, mark } = input;

  // Entry reference: what the flow paid; without a fill record, the live mark.
  const entryMax = flowAvgFill ?? mark ?? null;
  const vsFlow =
    flowAvgFill != null && flowAvgFill > 0 && mark != null
      ? round2(((mark - flowAvgFill) / flowAvgFill) * 100)
      : null;

  let status: EntryStatus;
  if (mark == null) status = "NO_QUOTE";
  else if (vsFlow != null && vsFlow >= CHASE_PCT) status = "MOVED";
  else if (vsFlow != null && vsFlow <= -10) status = "CHEAPER";
  else status = "IN_RANGE";

  // Underlying anchors: a long targets the nearest resistance above price and is
  // wrong below the nearest support (VWAP fallback); a short mirrors.
  let target: number | null = null;
  let invalid: number | null = null;
  if (price != null && price > 0) {
    if (direction === "long") {
      target = input.keyResistances.find((l) => l > price) ?? null;
      invalid = input.keySupports.find((l) => l < price) ?? input.vwap ?? null;
    } else {
      // keySupports/keyResistances arrive nearest-first (see enrichSetup) — a short
      // targets the nearest support below and is wrong above the nearest resistance.
      target = input.keySupports.find((l) => l < price) ?? null;
      invalid = input.keyResistances.find((l) => l > price) ?? input.vwap ?? null;
    }
  }

  return {
    occ,
    flow_avg_fill: flowAvgFill != null ? round2(flowAvgFill) : null,
    bid,
    ask,
    mark,
    entry_max: entryMax != null ? round2(entryMax) : null,
    vs_flow_pct: vsFlow,
    entry_status: status,
    stop_premium: entryMax != null ? round2(entryMax * (1 + PLAN_RULES.stop_pct / 100)) : null,
    target_premium: entryMax != null ? round2(entryMax * (1 + PLAN_RULES.target_pct / 100)) : null,
    time_stop_et: "15:30",
    underlying_target: target,
    underlying_invalid: invalid,
  };
}

// ── Plan grading (the accountability half) ────────────────────────────────────────

export type PlanBar = { t: number; h: number; l: number; c: number };

export type PlanOutcome = {
  outcome: "doubled" | "stopped" | "time_stop" | "ungradeable";
  /** P/L % of premium at exit vs entry. */
  pnl_pct: number | null;
};

/** ET minutes-since-midnight for an epoch-ms timestamp (DST-safe via Intl). */
export function etMinutesOf(epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * Grade the printed plan against the CONTRACT's own minute bars, walked in time
 * order from the flag onward: stop fires when the bar's low touches stop_premium,
 * target when the bar's high touches target_premium — when BOTH touch inside the
 * same bar, count the STOP (conservative; intrabar order is unknowable). Past the
 * time stop, exit at the last usable close ≤15:30 ET. No bars after the flag → ungradeable.
 */
export function gradePlanFromBars(
  bars: PlanBar[],
  entryPremium: number,
  flaggedAtMs: number
): PlanOutcome {
  if (!(entryPremium > 0)) return { outcome: "ungradeable", pnl_pct: null };
  const stop = entryPremium * (1 + PLAN_RULES.stop_pct / 100);
  const target = entryPremium * (1 + PLAN_RULES.target_pct / 100);
  const pnl = (exit: number) => round2(((exit - entryPremium) / entryPremium) * 100);

  let lastCloseInWindow: number | null = null;
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t < flaggedAtMs) continue;
    const pastTimeStop = etMinutesOf(bar.t) > PLAN_RULES.time_stop_et_minutes;
    if (pastTimeStop) break;
    // Conservative ordering: stop checked before target within the same bar.
    if (bar.l <= stop) return { outcome: "stopped", pnl_pct: pnl(stop) };
    if (bar.h >= target) return { outcome: "doubled", pnl_pct: pnl(target) };
    lastCloseInWindow = bar.c;
  }
  if (lastCloseInWindow == null) return { outcome: "ungradeable", pnl_pct: null };
  return { outcome: "time_stop", pnl_pct: pnl(lastCloseInWindow) };
}
