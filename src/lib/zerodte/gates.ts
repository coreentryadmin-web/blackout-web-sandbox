// 0DTE Command hard entry-gate stack (G-1..G-5) — the market-state discipline layer
// specified in docs/audit/NIGHTHAWK-0DTE-DECISION.md §2 and approved 2026-07-13
// ("best plays only"). The four evidence gates in ./board.ts measure FLOW CONVICTION
// (is somebody really loading this contract?); this module measures TRADE QUALITY
// (should WE commit a plan on it right now?). On 2026-07-13 the evidence gates
// committed 8/8 scanned candidates on a down tape and went 1W/7L — flow conviction
// alone is not a trade.
//
// Contract with the rest of the pipeline:
// - HARD gates apply to NEW plan commits only. Already-committed ledger rows are
//   NEVER retro-blocked or mutated — a printed play is managed to its exit, period.
// - Fail closed: missing/stale gate inputs block a NEW commit (same discipline as
//   the evidence gates' no_underlying_price rejection), never a free pass.
// - Fail visible: every block becomes a zerodte_scan_rejections row with a
//   machine-readable code + a human sentence, and rides the setup payload as a
//   WATCH/SKIP card — a member can always see WHY the desk sat one out.
// - Pure functions only (unit-testable, replayable against fixture sessions);
//   ./scan.ts assembles the async inputs.

import type { MarketBias } from "./intraday";
import type { EnrichedZeroDteSetup, ZeroDteGateFailure, ZeroDteGateRejection } from "./board";

// ── G-1 · Tape-alignment block ──────────────────────────────────────────────────
// Evidence (nh0dte forensics, 2026-07-13): counter-tape entries are the single most
// visible killer in the dataset — on 7/13 (SPY down all session) the board's longs
// went 0/5 (avg −54.7% premium) while the aligned shorts held 1W/2L. Until now this
// was only a −6 score dent (marketAlignAdjust, ./intraday.ts); a 93-score SPY long
// shrugged it off at 09:55 and stopped out. Promoted to a hard block.
/** Max age of the SPY read the bias came from. A bias computed from bars that
 *  stopped arriving 15+ minutes ago is a memory, not a market state — fail closed. */
export const MARKET_BIAS_MAX_AGE_MS = 15 * 60 * 1000;

export type ZeroDteGateBlock = {
  /** Machine-readable code — same namespace as the evidence gates' gate_failed. */
  code: ZeroDteGateFailure;
  /** Human sentence the SKIP card renders verbatim. */
  reason: string;
  /** Numeric threshold the candidate was measured against (null when structural). */
  threshold: number | null;
  /** "HH:MM ET" when the block self-expires on the clock (G-2), else null. */
  unlock_et: string | null;
};

export type ZeroDteGateVerdict = {
  verdict: "COMMIT" | "BLOCKED";
  /** Every hard gate that failed — ALL of them, not just the first, so the SKIP
   *  card can say "tape + window" instead of hiding the second reason. */
  blocks: ZeroDteGateBlock[];
};

export type ZeroDteGateInput = {
  ticker: string;
  direction: "long" | "short";
  /** Post-edge-layer score (after intraday/market/time-of-day adjusts). */
  score: number;
  /** ET minutes since midnight at evaluation time. */
  nowEtMinutes: number;
  /** Wall clock at evaluation time (staleness math). */
  nowMs: number;
  /** SPY/desk session bias (marketBias over the SPY intraday read); null = unknown. */
  bias: MarketBias | null;
  /** Epoch-ms of the newest SPY bar behind `bias` (IntradayRead.last_bar_ms). */
  biasAsOfMs: number | null;
};

/**
 * Evaluate the hard gate stack for ONE fresh (not-yet-committed) setup.
 * Deterministic: same inputs, same verdict. Collects every failing gate.
 */
export function evaluateZeroDteGates(input: ZeroDteGateInput): ZeroDteGateVerdict {
  const blocks: ZeroDteGateBlock[] = [];

  // G-1 — tape alignment. Order matters within the gate: an unreadable bias is its
  // own (fail-closed) block, distinct from a readable-but-opposed tape, so the
  // rejection log can tell "we couldn't see the tape" from "the tape said no".
  const biasStale =
    input.biasAsOfMs == null || input.nowMs - input.biasAsOfMs > MARKET_BIAS_MAX_AGE_MS;
  if (input.bias == null || biasStale) {
    blocks.push({
      code: "no_market_bias",
      reason:
        "Market tape read unavailable or stale — new commits fail closed until the SPY bias is readable again.",
      threshold: null,
      unlock_et: null,
    });
  } else if (input.bias !== "flat" && (input.bias === "up") !== (input.direction === "long")) {
    blocks.push({
      code: "tape_alignment",
      reason:
        `${input.direction === "long" ? "Long" : "Short"} setup fights the ${input.bias.toUpperCase()} market tape — ` +
        "counter-tape 0DTE entries are blocked (7/13 evidence: counter-tape longs went 0/5 at the stop).",
      threshold: null,
      unlock_et: null,
    });
  }

  return { verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT", blocks };
}

// ── Rejection-row bridge ───────────────────────────────────────────────────────────
// One zerodte_scan_rejections row per blocked setup per cycle: gate_failed is the
// PRIMARY (first-evaluated) failing gate, reason concatenates every failing gate's
// sentence. Deliberately ONE row, not one per block — persistZeroDteRejections'
// per-ticker throttle keys on (gate_failed, direction), and two alternating codes
// for one steadily-blocked setup would defeat the throttle and spam a row per scan
// tick. The full block list still rides the live setup payload (setup.gate.blocks).

/** Fields a gate rejection needs off the setup — everything the evidence-gate
 *  rejections also record, so both families are comparable in one table. */
type GateRejectionSource = Pick<
  EnrichedZeroDteSetup,
  | "ticker"
  | "direction"
  | "gross_premium"
  | "aggression"
  | "side_dominance"
  | "otm_pct"
  | "prints"
  | "first_seen"
  | "last_seen"
>;

/** Build the durable rejection row for a hard-gate-blocked setup. `verdict` null
 *  means the gate stack could not even be evaluated (context unavailable) — that is
 *  itself a fail-closed block, recorded honestly as such. */
export function gateRejectionFor(
  setup: GateRejectionSource,
  verdict: ZeroDteGateVerdict | null
): ZeroDteGateRejection {
  const primary: ZeroDteGateBlock =
    verdict && verdict.blocks.length > 0
      ? verdict.blocks[0]!
      : {
          code: "gate_context_unavailable",
          reason:
            "Gate inputs (session ledger / governor state) could not be read — new commits fail closed.",
          threshold: null,
          unlock_et: null,
        };
  return {
    ticker: setup.ticker,
    gate_failed: primary.code,
    reason: verdict && verdict.blocks.length > 0
      ? verdict.blocks.map((b) => b.reason).join(" ")
      : primary.reason,
    threshold: primary.threshold,
    gross_premium: setup.gross_premium,
    aggression: setup.aggression,
    side_dominance: setup.side_dominance,
    otm_pct: setup.otm_pct,
    direction: setup.direction,
    prints: setup.prints,
    first_seen: setup.first_seen,
    last_seen: setup.last_seen,
  };
}
