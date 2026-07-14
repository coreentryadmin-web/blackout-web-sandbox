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
import { evaluateZeroDteGovernor, type GovernorOpenPlan, type GovernorSnapshot } from "./governor";

// ── G-1 · Tape-alignment block ──────────────────────────────────────────────────
// Evidence (nh0dte forensics, 2026-07-13): counter-tape entries are the single most
// visible killer in the dataset — on 7/13 (SPY down all session) the board's longs
// went 0/5 (avg −54.7% premium) while the aligned shorts held 1W/2L. Until now this
// was only a −6 score dent (marketAlignAdjust, ./intraday.ts); a 93-score SPY long
// shrugged it off at 09:55 and stopped out. Promoted to a hard block.
/** Max age of the SPY read the bias came from. A bias computed from bars that
 *  stopped arriving 15+ minutes ago is a memory, not a market state — fail closed. */
export const MARKET_BIAS_MAX_AGE_MS = 15 * 60 * 1000;

// ── G-2 · Opening-window block ──────────────────────────────────────────────────
// USER-DIRECTED 2026-07-13: restrict only the FIRST 15 MINUTES (9:30-9:45 ET), not
// the decision doc's original 10:30 — most 0DTE plays happen at the open and the
// user does not want them blocked wholesale. Chosen KNOWINGLY against the F-4 cut
// (9:50-11:00 ran 36.8% WR n=19, and 7/13's four opening losers were flagged
// 9:50-10:20, i.e. AFTER this boundary — under this rule G-2 would NOT have caught
// them; G-1 tape alignment is the gate that removes them). The 9:45-10:30 band is
// measured by the calibration loop (gate_calibration_json.committed_at_et buckets
// every commit by ET time), so this boundary can be revisited with per-play
// evidence rather than re-litigated on priors. Setups found 9:30-9:45 stay visible
// as WATCH/SKIP cards carrying the unlock time — the scanner re-evaluates every
// ~2 minutes, so a setup still alive on the tape at 9:45 commits then. The
// existing no-new-plays->=15:00 + hard-exit-15:30 rules are unchanged and live
// upstream (persistZeroDteScan / PLAN_RULES).
export const OPENING_WINDOW_UNLOCK_ET_MINUTES = 9 * 60 + 45;
export const OPENING_WINDOW_UNLOCK_LABEL = "9:45 ET";

// ── G-4 · VIX regime throttle — CALIBRATION MODE (logs, never blocks) ───────────
// Evidence (F-1): the strongest per-play split in the whole forensics dataset —
// Slayer plays on days opening VIX 15-17 ran 69.2% WR (n=13, +1.85 pts avg) vs
// 25.0% WR (n=12, −1.54 pts) at 17-20. But it's a LOW-N Slayer-side cut, so per the
// decision doc it runs as calibration for ≥30 sessions: the verdict is computed and
// PINNED on every commit (gate_calibration_json), and the data decides whether to
// harden or drop it. would_block encodes the rule that WOULD apply:
//   VIX ≥ 17 → require tape alignment AND score ≥ 75;
//   VIX ≥ 20 → index/ETF products only, at half plan size.
export const VIX_ELEVATED_THRESHOLD = 17;
export const VIX_EXTREME_THRESHOLD = 20;
export const VIX_ELEVATED_SCORE_FLOOR = 75;
/** Products that stay tradable (at half size) in an extreme-VIX regime — broad
 *  index options + their ETF wrappers, where 0DTE liquidity survives a vol spike. */
export const INDEX_ETF_TICKERS = new Set([
  "SPX", "SPXW", "XSP", "SPY", "QQQ", "NDX", "NDXP", "IWM", "RUT", "RUTW", "DIA",
]);

export type ZeroDteVixCalibration = {
  day_open_vix: number | null;
  tier: "unknown" | "normal" | "elevated" | "extreme";
  /** Would the hardened G-4 have blocked this commit? (Logged, not enforced.) */
  would_block: boolean;
  /** Extreme tier's surviving index/ETF plays would print at half size. */
  would_halve_size: boolean;
  note: string;
};

// ── G-6 · Cross-system conflict — CALIBRATION MODE (logs, never blocks) ─────────
// Evidence (v1 §2.2): 7/13's META short opposed Night Hawk's 7/10 edition LONG A on
// META and was surfaced to members only as a whisper-echo. Slayer has an explicit
// satellite-conflict module; this is the 0DTE analogue. Hardened form would require
// score ≥ 80 to print a CONFLICT-flagged setup.
export const CONFLICT_SCORE_FLOOR = 80;
/** Tickers that trade the same broad-market direction as Slayer's SPX play — a
 *  0DTE short on any of these against a live Slayer long IS a desk disagreement. */
export const SPX_CORRELATED_TICKERS = new Set(["SPX", "SPXW", "XSP", "SPY", "QQQ", "NDX", "NDXP"]);

export type ZeroDteConflictCalibration = {
  conflict: boolean;
  /** Which system(s) this setup opposes (empty when clear). */
  against: Array<"spx_slayer" | "nighthawk_edition">;
  would_block: boolean;
  note: string;
};

/** The full calibration record pinned onto a committed ledger row
 *  (zerodte_setup_log.gate_calibration_json) — the C-2 context columns: after 30
 *  gated sessions this is what decides whether G-4/G-6 harden or drop. */
export type ZeroDteGateCalibration = {
  score_at_commit: number;
  market_bias: MarketBias | null;
  /** "HH:MM" ET at evaluation — the time-of-day bucket key for the calibration
   *  loop (e.g. measuring the 9:45–10:30 band the user chose to keep open). */
  committed_at_et: string;
  g4_vix: ZeroDteVixCalibration;
  g6_conflict: ZeroDteConflictCalibration;
};

// ── G-3 · Score floor ───────────────────────────────────────────────────────────
// Evidence (F-2): the engine's OWN 14-day calibration (38 graded plays) says the
// 55-64 band is where the money dies — 18.8% WR, avg −24.5% premium (n=16), far
// below the 33.3% breakeven of the fixed −50/+100 payoff. 65-74 ran 50% WR/+21.1%
// (n=10), 75+ 50%/+9.9% (n=12). The API's own calibration recommendation agrees:
// raise the floor above the 55-64 band. Judged AFTER the intraday edge layer, so a
// raw-evidence 70 that the tape/time-of-day layer marked down to 62 does NOT clear.
export const ZERODTE_SCORE_FLOOR = 65;

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
  /** G-4/G-6 calibration verdict (logged on every evaluation, pinned to the ledger
   *  row on commit; NEVER blocks while in calibration mode). */
  calibration: ZeroDteGateCalibration;
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
  /** G-5 session state (./governor.ts). Null = state unreadable → fail closed. */
  governor: GovernorSnapshot | null;
  /** Fresh commits already accepted earlier in this same scan cycle — feeds the
   *  governor's concurrency cap + correlated-conflict check so one cycle can't
   *  overshoot the cap or commit correlated-but-opposed plans together. */
  committedThisCycle?: GovernorOpenPlan[];
  /** Day-open VIX (Polygon I:VIX daily bar open). Null = unavailable — G-4 is
   *  calibration-only, so unknown is logged honestly, never guessed or blocking. */
  vixDayOpen?: number | null;
  /** SPX Slayer's live open play today (direction only). Null = none/unreadable. */
  slayerLive?: { direction: "long" | "short" } | null;
  /** Night Hawk's most recent take on THIS ticker (recency-filtered upstream). */
  nighthawkTake?: { direction: "long" | "short"; edition_for: string } | null;
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

  // G-2 — opening window (first 15 minutes only — user-directed 2026-07-13, see the
  // constant's doc). Clock-based, so the block self-expires: the card carries the
  // unlock time and the next scan cycle at/after 9:45 re-evaluates cleanly.
  if (input.nowEtMinutes < OPENING_WINDOW_UNLOCK_ET_MINUTES) {
    blocks.push({
      code: "opening_window",
      reason:
        `No new 0DTE commits in the first 15 minutes (before ${OPENING_WINDOW_UNLOCK_LABEL}) — ` +
        "ranges are still forming. " +
        `Watching; commits unlock at ${OPENING_WINDOW_UNLOCK_LABEL} if the setup is still live.`,
      threshold: OPENING_WINDOW_UNLOCK_ET_MINUTES,
      unlock_et: OPENING_WINDOW_UNLOCK_LABEL,
    });
  }

  // G-3 — score floor, judged on the FINAL post-edge-layer score.
  if (input.score < ZERODTE_SCORE_FLOOR) {
    blocks.push({
      code: "score_floor",
      reason:
        `Score ${Math.round(input.score)} is below the ${ZERODTE_SCORE_FLOOR} commit floor — ` +
        "the 55-64 band ran 18.8% WR / −24.5% avg premium (n=16) on this engine's own calibration, " +
        "under the 33% breakeven of the −50/+100 payoff.",
      threshold: ZERODTE_SCORE_FLOOR,
      unlock_et: null,
    });
  }

  // G-5 — session governor (./governor.ts). Unreadable state fails closed: a desk
  // that can't count its own open risk doesn't add more.
  if (input.governor == null) {
    blocks.push({
      code: "gate_context_unavailable",
      reason: "Session governor state could not be read — new commits fail closed.",
      threshold: null,
      unlock_et: null,
    });
  } else {
    blocks.push(
      ...evaluateZeroDteGovernor(
        { ticker: input.ticker, direction: input.direction },
        input.governor,
        input.nowMs,
        input.committedThisCycle ?? []
      )
    );
  }

  return {
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
    calibration: computeGateCalibration(input),
  };
}

/** "HH:MM" from ET minutes-since-midnight. */
function etLabel(etMinutes: number): string {
  const h = Math.floor(etMinutes / 60);
  const m = etMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * G-4 (VIX regime) + G-6 (cross-system conflict) — CALIBRATION MODE. Computed on
 * every evaluation and pinned to the ledger row at commit; deliberately NOT in the
 * blocking path until ≥30 sessions of would_block data say they earn it (both rest
 * on LOW-N cuts today — see the G-4/G-6 module docs above). Pure and deterministic.
 */
export function computeGateCalibration(input: ZeroDteGateInput): ZeroDteGateCalibration {
  const ticker = input.ticker.toUpperCase();
  const aligned: boolean | null =
    input.bias == null || input.bias === "flat"
      ? null
      : (input.bias === "up") === (input.direction === "long");

  // G-4 — VIX regime throttle verdict.
  const vix = input.vixDayOpen ?? null;
  let g4: ZeroDteVixCalibration;
  if (vix == null) {
    g4 = {
      day_open_vix: null,
      tier: "unknown",
      would_block: false,
      would_halve_size: false,
      note: "Day-open VIX unavailable — no G-4 verdict recorded (never guessed).",
    };
  } else if (vix >= VIX_EXTREME_THRESHOLD) {
    const isIndexEtf = INDEX_ETF_TICKERS.has(ticker);
    g4 = {
      day_open_vix: vix,
      tier: "extreme",
      would_block: !isIndexEtf,
      would_halve_size: isIndexEtf,
      note: isIndexEtf
        ? `VIX ${vix} ≥ ${VIX_EXTREME_THRESHOLD}: index/ETF product survives at HALF plan size under hardened G-4.`
        : `VIX ${vix} ≥ ${VIX_EXTREME_THRESHOLD}: single names blocked under hardened G-4 (index/ETF only).`,
    };
  } else if (vix >= VIX_ELEVATED_THRESHOLD) {
    const clears = aligned === true && input.score >= VIX_ELEVATED_SCORE_FLOOR;
    g4 = {
      day_open_vix: vix,
      tier: "elevated",
      would_block: !clears,
      would_halve_size: false,
      note: clears
        ? `VIX ${vix} ≥ ${VIX_ELEVATED_THRESHOLD}: aligned with score ≥ ${VIX_ELEVATED_SCORE_FLOOR} — clears hardened G-4.`
        : `VIX ${vix} ≥ ${VIX_ELEVATED_THRESHOLD}: hardened G-4 needs tape alignment AND score ≥ ${VIX_ELEVATED_SCORE_FLOOR} (17-20 regime ran 25% WR vs 69% at 15-17).`,
    };
  } else {
    g4 = {
      day_open_vix: vix,
      tier: "normal",
      would_block: false,
      would_halve_size: false,
      note: `VIX ${vix} < ${VIX_ELEVATED_THRESHOLD}: normal regime.`,
    };
  }

  // G-6 — cross-system conflict verdict.
  const against: Array<"spx_slayer" | "nighthawk_edition"> = [];
  if (
    input.slayerLive != null &&
    SPX_CORRELATED_TICKERS.has(ticker) &&
    input.slayerLive.direction !== input.direction
  ) {
    against.push("spx_slayer");
  }
  if (input.nighthawkTake != null && input.nighthawkTake.direction !== input.direction) {
    against.push("nighthawk_edition");
  }
  const conflict = against.length > 0;
  const g6: ZeroDteConflictCalibration = {
    conflict,
    against,
    would_block: conflict && input.score < CONFLICT_SCORE_FLOOR,
    note: conflict
      ? `CONFLICT: ${input.direction} opposes ${against
          .map((a) =>
            a === "spx_slayer"
              ? `the live SPX Slayer ${input.slayerLive!.direction}`
              : `Night Hawk's ${input.nighthawkTake!.direction} take (edition ${input.nighthawkTake!.edition_for})`
          )
          .join(" and ")} — hardened G-6 would require score ≥ ${CONFLICT_SCORE_FLOOR}.`
      : "No cross-system conflict.",
  };

  return {
    score_at_commit: Math.round(input.score),
    market_bias: input.bias,
    committed_at_et: etLabel(input.nowEtMinutes),
    g4_vix: g4,
    g6_conflict: g6,
  };
}

// ── G-6 input normalization ────────────────────────────────────────────────────────

/** How far back a Night Hawk take on a ticker still counts as "today's context".
 *  The 7/13 META conflict was against the 7/10 edition (3 calendar days) — the
 *  echo's most-recent-row-per-ticker can reach back arbitrarily far, and a
 *  two-week-old edition take is history, not a live desk position. */
export const NIGHTHAWK_TAKE_MAX_AGE_DAYS = 5;

/** Normalize a nighthawk_echo row into a G-6 input: recency-bounded, direction
 *  strictly long/short (anything else is not a directional take). Pure. */
export function recentNighthawkTake(
  echo: { direction: string; edition_for: string } | null | undefined,
  todayYmd: string
): { direction: "long" | "short"; edition_for: string } | null {
  if (!echo) return null;
  if (echo.direction !== "long" && echo.direction !== "short") return null;
  const editionMs = Date.parse(echo.edition_for);
  const todayMs = Date.parse(todayYmd);
  if (!Number.isFinite(editionMs) || !Number.isFinite(todayMs)) return null;
  const ageDays = (todayMs - editionMs) / 86_400_000;
  if (ageDays < 0 || ageDays > NIGHTHAWK_TAKE_MAX_AGE_DAYS) return null;
  return { direction: echo.direction, edition_for: echo.edition_for.slice(0, 10) };
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
