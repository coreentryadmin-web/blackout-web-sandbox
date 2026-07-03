// BlackOut Intelligence — the desk's shared brain for 0DTE plays. One verb a
// trader can act on (ADD / HOLD / TRIM / SELL / PASS) plus a 1-2 sentence reason
// composed ONLY from observed numbers: tape evidence, aggressor share, dealer
// positioning, live intraday read, premium state vs the fixed rules — with LIVE
// distances and countdowns, recomputed on every refresh. Pure and deterministic
// (no LLM, no latency, unit-testable); the board renders it, Largo consumes the
// exact same lines via get_zerodte_plays — one brain, many mouths.

import type { EnrichedZeroDteSetup } from "./board";
import type { ContractPlan } from "./plan";

export type IntelAction = "ADD" | "HOLD" | "TRIM" | "SELL" | "PASS";

export type IntelNote = {
  action: IntelAction;
  reason: string;
};

const money = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(2)}`;
};
const prem = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";

/** The strongest evidence clause for a fresh/holding play, built from real numbers. */
function evidenceClause(s: EnrichedZeroDteSetup | null): string {
  if (!s) return "Stacked one-sided 0DTE flow";
  const side = s.direction === "long" ? "call" : "put";
  const bits: string[] = [
    `${money(s.gross_premium)} ${Math.round(s.side_dominance * 100)}% ${side}-side` +
      (s.aggression != null && s.aggression >= 0.6 ? ` (${Math.round(s.aggression * 100)}% at the ask)` : ""),
  ];
  if (s.new_money) bits.push("size exceeds OI — opening positioning");
  if (s.spike) bits.push(`${money(s.recent_premium_30m)} in the last 30m`);
  else if (s.streak_days != null && s.streak_days > 1) bits.push(`${s.streak_days}-day flow streak`);
  return bits.join("; ");
}

/** Chart/positioning confirmation clause — only when we actually have it. */
function confirmClause(s: EnrichedZeroDteSetup | null): string | null {
  if (!s) return null;
  const bits: string[] = [];
  // Live intraday read first — it's what a scalper actually trades from.
  const id = s.intraday;
  if (id?.last != null && id.vwap != null) {
    const above = id.last > id.vwap;
    if ((s.direction === "long") === above) bits.push(`${above ? "holding above" : "pressing below"} session VWAP ${id.vwap}`);
  }
  if (id?.or_break === "above" && s.direction === "long") bits.push("opening-range breakout north");
  if (id?.or_break === "below" && s.direction === "short") bits.push("opening-range breakdown south");
  if (s.market_aligned === true) bits.push("with the market tape");
  if (s.gex_king_strike != null && s.underlying_price != null) {
    const above = s.underlying_price > s.gex_king_strike;
    if (s.direction === "long" && above) bits.push(`price riding above the ${s.gex_king_strike} king node`);
    else if (s.direction === "short" && !above) bits.push(`price pinned below the ${s.gex_king_strike} king node`);
  }
  if (s.fib_note?.golden) bits.push("sitting in the golden pocket");
  if (s.trend && ((s.direction === "long" && /up/i.test(s.trend)) || (s.direction === "short" && /down/i.test(s.trend))))
    bits.push(`${s.trend} confirms`);
  if (s.dark_pool_bias && ((s.direction === "long" && /bull/i.test(s.dark_pool_bias)) || (s.direction === "short" && /bear/i.test(s.dark_pool_bias))))
    bits.push(`dark pool ${s.dark_pool_bias}`);
  return bits.length ? bits.slice(0, 2).join(", ") : null;
}

/**
 * Build the intel note for a play row. `status` is the derived lifecycle state
 * (OPEN/HOLD/TRIM/CLOSED/SKIP from the board's state machine).
 */
export function buildIntelNote(input: {
  status: "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "SKIP";
  setup: EnrichedZeroDteSetup | null;
  plan: ContractPlan | null;
  entryPremium: number | null;
  livePnlPct: number | null;
  planOutcome: string | null;
  planPnlPct: number | null;
  /** Live clock (ET minutes) — enables countdowns to the 15:00 cutoff / 15:30 exit. */
  nowEtMinutes?: number | null;
  /** Live contract mark — enables $-distances to the trim/stop triggers. */
  lastMark?: number | null;
}): IntelNote {
  const { status, setup, plan, entryPremium, livePnlPct, planOutcome, planPnlPct, nowEtMinutes, lastMark } = input;
  const stop = entryPremium != null ? entryPremium * 0.5 : null;
  const target = entryPremium != null ? entryPremium * 2 : null;
  const confirm = confirmClause(setup);
  const minsTo = (deadline: number): number | null =>
    nowEtMinutes != null && nowEtMinutes < deadline ? deadline - nowEtMinutes : null;
  const toCutoff = minsTo(15 * 60);
  const toExit = minsTo(15 * 60 + 30);

  if (status === "SKIP") {
    if (plan?.illiquid) {
      return {
        action: "PASS",
        reason: `Strong tape, untradeable market — spread is ${plan.spread_pct?.toFixed(0)}% of the mark, so every exit gets taxed. Pass until the market tightens.`,
      };
    }
    if (plan?.entry_status === "MOVED") {
      return {
        action: "PASS",
        reason: `Premium already ran ${plan.vs_flow_pct != null ? `+${plan.vs_flow_pct.toFixed(0)}%` : "well"} past the flow's ${prem(plan.flow_avg_fill)} fill — the move happened without you. Chasing here flips the math against the trade.`,
      };
    }
    return {
      action: "PASS",
      reason: "Flagged after the 3:00 ET cutoff — a fresh 0DTE entry this late trades against the clock, not the tape. Watch-only.",
    };
  }

  if (status === "OPEN") {
    const reload = setup?.spike === true;
    const caution =
      setup?.market_aligned === false
        ? " Fighting the market tape — half size."
        : setup?.tod_label?.includes("chop")
          ? ` ${setup.tod_label.charAt(0).toUpperCase()}${setup.tod_label.slice(1)}.`
          : "";
    return {
      action: "ADD",
      reason:
        `${evidenceClause(setup)}${confirm ? `; ${confirm}` : ""}. ` +
        `${reload ? "Flow is reloading now — " : ""}Enter ≤ ${prem(plan?.entry_max ?? entryPremium)}, stop ${prem(stop)}, out by 3:30 ET` +
        `${toCutoff != null && toCutoff <= 90 ? ` (${toCutoff}m left in the entry window)` : ""}.${caution}`,
    };
  }

  if (status === "TRIM") {
    return {
      action: "TRIM",
      reason: `Premium tagged +100% (target ${prem(target)}) — bank at least half here. The rest is house money: trail it to ${plan?.underlying_target != null ? `the ${plan.underlying_target} level` : "the 3:30 ET exit"}${toExit != null ? ` (${toExit}m left)` : ""}, never let a double go red.`,
    };
  }

  if (status === "HOLD") {
    const pnlBit = livePnlPct != null ? `${livePnlPct >= 0 ? "+" : ""}${livePnlPct.toFixed(0)}% on the premium` : "position working";
    // Live trigger distances — these move with every refresh.
    const mark = lastMark ?? (entryPremium != null && livePnlPct != null ? entryPremium * (1 + livePnlPct / 100) : null);
    const dist =
      mark != null && target != null && stop != null
        ? ` — ${prem(Math.max(0, target - mark))} below the trim, ${prem(Math.max(0, mark - stop))} above the stop`
        : "";
    return {
      action: "HOLD",
      reason:
        `Thesis intact — ${pnlBit}${dist}${confirm ? `; ${confirm}` : ""}. ` +
        `Triggers: ${prem(target)} (+100% trim) / ${prem(stop)} (−50% cut)` +
        `${toExit != null ? `; ${toExit}m to the 3:30 hard exit` : "; hard exit 3:30 ET"}.`,
    };
  }

  // CLOSED — the verdict, in plain terms.
  if (planOutcome === "doubled" || (planPnlPct != null && planPnlPct > 0) || (planOutcome == null && livePnlPct != null && livePnlPct > 0)) {
    const pct = planPnlPct ?? livePnlPct;
    return {
      action: "SELL",
      reason: `Done — ${pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%` : "target discipline"} booked${planOutcome === "doubled" ? " at the +100% target" : ""}. 0DTE profits are taken, not admired.`,
    };
  }
  if (planOutcome === "stopped" || (livePnlPct != null && livePnlPct <= -50)) {
    return {
      action: "SELL",
      reason: `Stopped at −50% (${prem(stop)}) — the flow never followed through. Discipline beat hope; capital saved for the next print.`,
    };
  }
  return {
    action: "SELL",
    reason: `Closed at the 3:30 ET hard exit${livePnlPct != null ? ` (${livePnlPct >= 0 ? "+" : ""}${livePnlPct.toFixed(0)}%)` : ""} — 0DTE theta owns the final stretch; never hold through it.`,
  };
}
