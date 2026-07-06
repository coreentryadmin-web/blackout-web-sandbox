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
  /** Bid/ask spread as % of mark — exit tax. >15% flags the market as too thin. */
  spread_pct: number | null;
  illiquid: boolean;
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

  const spreadPct =
    bid != null && ask != null && ask > 0 && mark != null && mark > 0
      ? round2(((ask - bid) / mark) * 100)
      : null;
  // Wide markets tax every exit twice — a strong tape on an untradeable contract
  // is still a pass for a 0DTE scalp.
  const illiquid = spreadPct != null && spreadPct > 15;

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
    spread_pct: spreadPct,
    illiquid,
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

// ── Live play lifecycle (pure) ────────────────────────────────────────────────────
// A play's status is DERIVED, never hand-set: entry premium + fixed rules + the
// contract's live mark (with latched peak/trough so a stop stays a stop even if
// the premium bounces). 0DTE discipline: no new plays after the entry cutoff,
// everything closes by the time stop — nothing is ever carried overnight.

/** No NEW plays once power hour starts; existing plays are managed to exit. */
export const NEW_PLAY_CUTOFF_ET_MINUTES = 15 * 60;

export type PlayStatus = "OPEN" | "HOLD" | "TRIM" | "CLOSED";

export type LivePlayState = {
  status: PlayStatus;
  /** Premium P/L % vs entry at the current mark (null without a mark). */
  live_pnl_pct: number | null;
  /** Why a CLOSED play closed. */
  closed_reason: "stopped" | "time_stop" | null;
};

/**
 * Derive the play's lifecycle state. `peak`/`trough` are the latched extremes of
 * the mark SINCE the flag (persisted by the scanner each tick), so transitions
 * are sticky: trough ≤ stop → CLOSED forever; peak ≥ target → TRIM until close.
 * OPEN means "still enterable": mark within 10% of entry and before the cutoff.
 */
export function derivePlayStatus(input: {
  entryPremium: number | null;
  mark: number | null;
  peak: number | null;
  trough: number | null;
  nowEtMinutes: number;
}): LivePlayState {
  const { entryPremium, mark, peak, trough, nowEtMinutes } = input;
  const pnl =
    entryPremium != null && entryPremium > 0 && mark != null && mark > 0
      ? Math.round(((mark - entryPremium) / entryPremium) * 10000) / 100
      : null;

  // The hard exit closes EVERYTHING — including rows with no entry premium or no
  // quote. 0DTE has no tomorrow; data quality never exempts a play from the clock.
  if (nowEtMinutes > PLAN_RULES.time_stop_et_minutes) {
    return { status: "CLOSED", live_pnl_pct: pnl, closed_reason: "time_stop" };
  }
  if (!(entryPremium != null && entryPremium > 0)) {
    return { status: "HOLD", live_pnl_pct: null, closed_reason: null };
  }
  const stop = entryPremium * (1 + PLAN_RULES.stop_pct / 100);
  const target = entryPremium * (1 + PLAN_RULES.target_pct / 100);

  // Target checked BEFORE stop. peak/trough are latched extremes with no timestamp,
  // so a naive stop-first check can't tell "hit stop, never recovered" apart from
  // "hit target first, THEN craters" — both eventually show trough <= stop. But peak
  // only ever grows once set, so checking peak first makes a target hit STICKY: once
  // any tick pushes peak >= target, every future tick (this function is re-evaluated
  // every scan cycle against the still-open row) keeps returning TRIM regardless of
  // what trough does afterward — matching gradePlanFromBars' chronological "first
  // touch wins" grading and this file's own "peak >= target -> TRIM until close" doc
  // comment. A genuine stop-first case is unaffected: peak can't have reached target
  // yet when the row closes, so it still falls through to the stop check below.
  if (peak != null && peak >= target) {
    return { status: "TRIM", live_pnl_pct: pnl, closed_reason: null };
  }
  if (trough != null && trough <= stop) {
    return { status: "CLOSED", live_pnl_pct: PLAN_RULES.stop_pct, closed_reason: "stopped" };
  }
  if (mark != null && mark <= entryPremium * 1.1 && nowEtMinutes < NEW_PLAY_CUTOFF_ET_MINUTES) {
    return { status: "OPEN", live_pnl_pct: pnl, closed_reason: null };
  }
  return { status: "HOLD", live_pnl_pct: pnl, closed_reason: null };
}
