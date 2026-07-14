// BlackOut Intelligence — the desk's shared brain for 0DTE plays. One verb a
// trader can act on (ADD / HOLD / TRIM / SELL / PASS) plus a 1-2 sentence reason
// composed ONLY from observed numbers: tape evidence, aggressor share, dealer
// positioning, live intraday read, premium state vs the fixed rules — with LIVE
// distances and countdowns, recomputed on every refresh. Pure and deterministic
// (no LLM, no latency, unit-testable); the board renders it, Largo consumes the
// exact same lines via get_zerodte_plays — one brain, many mouths.

import type { EnrichedZeroDteSetup } from "./board";
import type { ContractPlan } from "./plan";
import { fmtPremium as money } from "@/lib/fmt-money";

export type IntelAction = "ADD" | "HOLD" | "TRIM" | "SELL" | "PASS" | "WATCH";

export type IntelNote = {
  action: IntelAction;
  reason: string;
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
  status: "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "SKIP" | "WATCH";
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
    // A hard-gate BLOCK is the real, most-fundamental reason a fresh find was refused,
    // so narrate the gate's OWN sentence(s) verbatim — the exact copy the board's
    // SkipCard renders (ZeroDteBoard.tsx) — BEFORE any plan-level (chase/liquidity) or
    // clock reason. This branch was previously ABSENT: the SKIP path fell straight
    // through to the unconditional "after the 3:00 ET cutoff" line below, fabricating a
    // time-cutoff reason for finds actually blocked by the score floor / tape / governor
    // mid-session. Live 2026-07-14 ~10:15 ET: SPXW 7540P score 43 was correctly BLOCKED
    // by G-3 (43 < 65 floor) yet Largo narrated it as "Flagged after the 3:00 ET cutoff
    // … Watch-only." — false on both counts (it was 10 AM; the real block was the score
    // floor). A fabricated refusal reason is exactly the dishonesty this platform exists
    // to avoid. The board's SkipCard was unaffected: it reads setup.gate.blocks directly
    // and only shows the "late window" line when blocks.length === 0 — this makes the
    // Largo consumer block-aware the same way. (The trade decision is unchanged: a
    // blocked find stays PASS/refused; only the EXPLANATION becomes honest.)
    const gateBlocks = setup?.gate?.verdict === "BLOCKED" ? setup.gate.blocks : [];
    if (gateBlocks.length > 0) {
      return {
        action: "PASS",
        reason: `Not committed — ${gateBlocks.map((b) => b.reason).join(" ")} Watch-only.`,
      };
    }
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
    // Genuine post-cutoff SKIP: no hard block, not a chase, not illiquid — the only
    // remaining honest reason a fresh find is refused is the 15:00 ET no-new-entries
    // cutoff (resolveFreshFindStatus's pastCutoff branch, board.ts, which fires exactly
    // when the clock is in POWER_HOUR/LATE_SESSION/CLOSED, i.e. ≥ 15:00 ET). Guard on
    // the live clock so this line can NEVER be emitted before the cutoff — a mislabeled
    // SKIP mid-session must not invent a 3 PM reason at 10 AM.
    const CUTOFF_ET_MINUTES = 15 * 60;
    if (nowEtMinutes != null && nowEtMinutes >= CUTOFF_ET_MINUTES) {
      return {
        action: "PASS",
        reason: "Flagged after the 3:00 ET cutoff — a fresh 0DTE entry this late trades against the clock, not the tape. Watch-only.",
      };
    }
    // No block, not moved/illiquid, and either the clock is unknown or still inside the
    // entry window — we have no concrete refusal reason, so don't fabricate one.
    return {
      action: "PASS",
      reason: "Not committed — the desk has not cleared this fresh find for entry. Watch-only.",
    };
  }

  // WATCH: a FRESH find that survived the display-side screens but has NO ledger
  // commit yet (resolveFreshFindStatus, board.ts). The evidence is shown, the verb
  // is explicitly not actionable — "ADD" here would be a buy call on a candidate
  // whose gate/plan read can still flap on the next scan tick. It only becomes an
  // OPEN play (and only then earns "ADD") when the desk's commit prints a ledger
  // row, which is a one-way door.
  if (status === "WATCH") {
    return {
      action: "WATCH",
      reason:
        `${evidenceClause(setup)}${confirm ? `; ${confirm}` : ""}. ` +
        `Candidate only — the desk has NOT committed this play yet. It becomes an OPEN position ` +
        `only after every hard gate and confirmation clears at commit; do not enter ahead of that.`,
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
    // TRIM is sticky once a play's peak has ever cleared +100% (see derivePlayStatus in
    // plan.ts) — intentional, so a play that doubled is never relabeled "stopped" on the
    // way back down. But that means a play can sit in TRIM well after giving the double
    // back, and the copy below used to always talk as if the double were still live and
    // actionable right now ("bank it", "never let a double go red") even once livePnlPct
    // had gone negative — actively misleading at the exact moment a member most needs an
    // honest read. Branch on the real current P&L instead of assuming it's still +100%+.
    if (livePnlPct != null && livePnlPct < 0) {
      return {
        action: "TRIM",
        reason: `Already doubled and gave it back — sitting at ${livePnlPct.toFixed(0)}% now, past the +100% trim window. The bank-it moment already passed; this is a hold-or-cut call from here, not a fresh trim.`,
      };
    }
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
