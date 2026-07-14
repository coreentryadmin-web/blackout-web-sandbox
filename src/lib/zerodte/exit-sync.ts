// 0DTE EXIT ENGINE — the sync-path wiring (IO half of ./exit-engine.ts, same
// pure-core/IO-shell split as cortex-gate.ts vs the cortex barrel). scan.ts's
// syncLedgerLiveState calls evaluateLedgerRowExit once per still-open row AFTER
// derivePlayStatus has had its pass — the plan's own latched stop/target/time-stop
// machinery stays exactly as it was; the engine only ADDS exits (ratchet floors,
// thesis break, flat timeout, fresh-mark stop/target breaches) on top of it.
//
// Discipline mirrors the rest of the directory:
//  - FRESHEST MARK WINS: the ~1s live-marks lane mark is preferred when fresh
//    (isZeroDteMarkStale, the same 5s staleness rule every renderer applies); the
//    sync pass's own snapshot mark is the fallback. No mark → no exit (the engine
//    holds on missing data by contract).
//  - CORTEX BOUNDED + FAIL-SOFT: evidence for open plays reuses the entry stack
//    (fetchCortexInputs → composeCortexEvidence), cached ~30s per (ticker,
//    direction) across pollers/replicas and soft-deadlined, so the ~2-min cron sync
//    and the board's 5s build can never stack provider fan-outs. Any failure →
//    evidence null → the thesis-break check is skipped and every other rule still
//    runs. The engine NEVER exits on missing data.
//  - NEVER THROWS: a bug here must not be able to break the ledger sync — worst
//    case is "no engine exit this tick", and the plan's own stop/time-stop rules
//    still stand.

import { dbConfigured, stampZeroDteExitContext, type ZeroDteSetupLogRow } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";
import { withServerCache } from "@/lib/server-cache";
import { composeCortexEvidence } from "@/lib/nighthawk/cortex/compose";
import { fetchCortexInputs } from "@/lib/nighthawk/cortex/fetch";
import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import {
  buildExitContext,
  evaluateExitState,
  type ExitDecision,
  type ZeroDteExitContext,
} from "./exit-engine";
import { getZeroDteLiveMark, type ZeroDteLiveMark } from "./live-marks";
import { isZeroDteMarkStale, pinnedLivePnlPct } from "./marks-math";
import { PLAN_RULES } from "./plan";

/** Evidence cache TTL — one Cortex fan-out per (ticker, direction) per ~30s across
 *  every sync caller, not per row per tick. */
const EXIT_EVIDENCE_TTL_MS = 30_000;
/** Soft deadline on the whole evidence read (fetchCortexInputs is itself per-source
 *  time-budgeted at 2.5s; this bounds the worst case at the call site too). */
const EXIT_EVIDENCE_WAIT_MS = 4_000;

/** Await `p` for at most `ms`, else null — same semantics as scan.ts's within();
 *  duplicated (7 lines) rather than imported because scan.ts imports THIS module,
 *  and importing back would create a require cycle (entry-context.ts precedent). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * Bounded, cached, fail-soft Cortex evidence for an OPEN play's own direction.
 * Returns the verdict's full item list (vetoes + opposes + supports, decayed
 * weights) or null when the Cortex could not see — the engine treats null as
 * "thesis check skipped", never as an exit signal.
 */
async function fetchExitEvidence(ticker: string, direction: "long" | "short"): Promise<EvidenceItem[] | null> {
  const key = `zerodte:exit-cortex:${ticker.toUpperCase()}:${direction}:${todayEt()}`;
  return within(
    withServerCache<EvidenceItem[]>(key, EXIT_EVIDENCE_TTL_MS, async () => {
      const inputs = await fetchCortexInputs(ticker, direction, { now: new Date() });
      const verdict = composeCortexEvidence(inputs);
      return [...verdict.vetoes, ...verdict.opposes, ...verdict.supports];
    }),
    EXIT_EVIDENCE_WAIT_MS
  );
}

/** The entry's committed Cortex score off the pinned entry_context blob (the margin
 *  the thesis-break opposing cluster must beat). Null when the row predates the
 *  wire-in, the Cortex abstained, or the blob is malformed. */
export function entryCortexScoreOf(entryContext: Record<string, unknown> | null): number | null {
  const cortex = entryContext?.cortex as Record<string, unknown> | undefined;
  if (!cortex || cortex.abstained === true) return null;
  const score = cortex.score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/** Injectable IO seams (cortex-gate.ts's CortexCommitDeps idiom) so the wiring is
 *  unit-testable without module mocks or a live platform. */
export type ExitSyncDeps = {
  readLaneMark?: (occ: string) => ZeroDteLiveMark | undefined;
  fetchEvidence?: (ticker: string, direction: "long" | "short") => Promise<EvidenceItem[] | null>;
  stampExit?: ((sessionDate: string, ticker: string, exit: Record<string, unknown>) => Promise<void>) | null;
  nowMs?: number;
};

export type ZeroDteRowExit = {
  /** The mark the engine exited at — becomes the row's frozen last_mark. */
  mark: number;
  decision: ExitDecision;
  exitContext: ZeroDteExitContext;
};

/**
 * Evaluate the exit engine for one STILL-OPEN ledger row (the caller has already
 * run derivePlayStatus and skips rows it closed). Returns the exit to apply, or
 * null for anything else — HOLD/RAISE_FLOOR/TRIM decisions change nothing here
 * (TRIM is already derived + persisted by the peak latch; the engine's TRIM can
 * only agree with it). On EXIT the counterfactual record is stamped into the row's
 * entry_context.exit (first-write-wins, best-effort) before the caller persists
 * the CLOSED state.
 */
export async function evaluateLedgerRowExit(
  row: ZeroDteSetupLogRow,
  opts: { syncMark: number | null; status: string; nowEtMinutes?: number },
  deps: ExitSyncDeps = {}
): Promise<ZeroDteRowExit | null> {
  try {
    const nowMs = deps.nowMs ?? Date.now();
    const occ = typeof row.plan_json?.occ === "string" ? (row.plan_json.occ as string) : null;

    // Freshest mark wins: lane mark if fresh (≤5s, the app-wide staleness rule),
    // else this sync pass's own snapshot mark. NEVER the row's stale last_mark —
    // exiting a play at a price nobody just observed is the wrong-number class
    // this whole lane exists to kill.
    const lane = occ ? (deps.readLaneMark ?? getZeroDteLiveMark)(occ) : undefined;
    const laneFresh = lane != null && lane.mark != null && !isZeroDteMarkStale(lane.asOf, nowMs);
    const mark = laneFresh ? lane!.mark : opts.syncMark;

    const entry = row.entry_premium;
    // No mark or no entry → the engine will hold anyway; skip the Cortex spend.
    if (mark == null || entry == null || entry <= 0) return null;

    const evidence = await (deps.fetchEvidence ?? fetchExitEvidence)(row.ticker, row.direction);

    const peak = row.peak_premium != null ? Math.max(row.peak_premium, mark) : mark;
    const ageMinutes = Number.isFinite(Date.parse(row.first_flagged_at))
      ? Math.max(0, (nowMs - Date.parse(row.first_flagged_at)) / 60_000)
      : null;
    const planStop =
      typeof row.plan_json?.stop_premium === "number"
        ? (row.plan_json.stop_premium as number)
        : entry * (1 + PLAN_RULES.stop_pct / 100);
    const planTarget =
      typeof row.plan_json?.target_premium === "number"
        ? (row.plan_json.target_premium as number)
        : entry * (1 + PLAN_RULES.target_pct / 100);

    const decision = evaluateExitState({
      entryPremium: entry,
      currentMark: mark,
      peakPremium: peak,
      ageMinutes,
      cortexEvidence: evidence,
      planStop,
      planTarget,
      status: opts.status,
      // TRIM is sticky via the peak latch, so status alone carries the trim fact.
      trimmed: opts.status === "TRIM",
      entryCortexScore: entryCortexScoreOf(row.entry_context),
    });
    if (decision.action !== "EXIT") return null;

    const exitContext = buildExitContext(decision, entry, mark, peak, nowMs);
    // Counterfactual record, first-write-wins (the SQL guards re-stamps): the
    // record page can later compute "exit saved X% vs riding to the close" from
    // this + the grader's close_price, with no new table. Best-effort by design —
    // a failed stamp must never block the actual protective exit below.
    const stamp = deps.stampExit === undefined ? (dbConfigured() ? stampZeroDteExitContext : null) : deps.stampExit;
    if (stamp) {
      await stamp(row.session_date, row.ticker, exitContext as unknown as Record<string, unknown>).catch(() => {});
    }
    return { mark, decision, exitContext };
  } catch {
    // A bug in the engine wiring must never break the ledger sync: no exit this
    // tick; the plan's own stop/time-stop rules still stand.
    return null;
  }
}

/** Live P&L at an exit mark — re-exported convenience for callers logging exits. */
export { pinnedLivePnlPct };
