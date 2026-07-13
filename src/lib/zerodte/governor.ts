// 0DTE Command session governor (G-5) — the portfolio-level risk layer this surface
// never had. Mirrors the SHAPE of SPX Slayer's trade governor (entry caps, loss
// halt, re-entry locks — src/features/spx/lib/trade-governor.ts, read-only
// reference) but is deliberately zerodte-local: this surface has its own ledger,
// its own fixed −50/+100 plan, and no playbook/desk machinery, so importing the
// Slayer module would drag in its whole config/desk graph for three rules.
//
// Evidence (NIGHTHAWK-0DTE-DECISION.md §2, G-5): 2026-07-13 had SEVEN stops with no
// ceiling — the scanner kept committing fresh plans all the way down. Slayer's
// governor (halt after 3 losses, re-entry locks) is the one piece of its stack with
// a proven closed-ledger effect (48% WR from a ~42% signal environment).
//
// State model — deterministic and replica-safe:
// - open plans and the stopped-play COUNT derive from the Postgres ledger
//   (zerodte_setup_log), which every replica already shares — the halt decision
//   never depends on a cache being warm.
// - Stop TIMESTAMPS (which Postgres doesn't store) are recorded to Redis via the
//   shared cache (same lane the zerodte:board:v1 payload cache rides), keyed by
//   session date, so the 20-minute re-entry lock agrees across replicas. Losing
//   Redis degrades ONLY the lock's timing precision (an untimed ledger stop still
//   counts toward the halt); it never un-halts a halted session.
//
// Pure evaluation + thin persistence, same split as ./gates.ts.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { PLAN_RULES } from "./plan";
import type { ZeroDteSetupLogRow } from "@/lib/db";
import type { ZeroDteGateBlock } from "./gates";

/** Max simultaneously-open plans. Slayer allows 5 entries/session on ONE instrument
 *  with an exit engine; this breadth surface manages every play to a fixed plan, so
 *  the concurrent-exposure cap is tighter. */
export const GOVERNOR_MAX_CONCURRENT_PLANS = 3;
/** Stops in a session before the desk stands down for the day (Slayer's own
 *  loss-halt number). 7/13 took 7 stops — this caps that class of day at 3. */
export const GOVERNOR_MAX_SESSION_STOPS = 3;
/** Same-direction re-entry lock on a ticker after its stop (Slayer's 20m rule). */
export const GOVERNOR_REENTRY_LOCK_MS = 20 * 60 * 1000;

export type GovernorStopEvent = {
  ticker: string;
  direction: "long" | "short";
  /** Epoch-ms the stop was observed (Redis-recorded). Null for stops derived from
   *  the ledger alone (Postgres stores no stop time) — those still count toward the
   *  session halt but cannot drive the timed re-entry lock. Never fabricated. */
  at_ms: number | null;
};

export type GovernorOpenPlan = { ticker: string; direction: "long" | "short" };

export type GovernorSnapshot = {
  /** Plans currently not CLOSED (null status = just committed, presumptively live).
   *  Carried as (ticker, direction) pairs — one source for BOTH the concurrency
   *  count and the correlated-conflict check. */
  open_plans: GovernorOpenPlan[];
  /** One entry per stopped ticker this session (ledger ∪ Redis-recorded). */
  stops: GovernorStopEvent[];
};

// B-3 (docs/audit/0DTE-BREAKTHROUGH-LEDGER.md) — correlated-conflict rule.
// Evidence: 7/13 ran SPY long AND QQQ short simultaneously — correlated
// instruments, one guaranteed loser. v1 keeps ONE static group (the broad
// index/ETF complex); sector pairs (e.g. NVDA/AMD) come later via the calibration
// loop once per-play evidence says which pairs actually co-move enough to matter.
export const CORRELATION_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "XSP"]),
];

/** The correlation group a ticker belongs to, or null. */
function correlationGroupOf(ticker: string): ReadonlySet<string> | null {
  for (const g of CORRELATION_GROUPS) if (g.has(ticker)) return g;
  return null;
}

/** The ledger fields the governor reads — subset so tests need no full row. */
export type GovernorLedgerRow = Pick<
  ZeroDteSetupLogRow,
  "ticker" | "direction" | "status" | "entry_premium" | "trough_premium" | "plan_outcome"
>;

/** Did this ledger row stop out? Two independent signals, either suffices:
 *  the graded plan_outcome, or the latched trough at/below the plan's stop level
 *  (derivePlayStatus's own CLOSED/stopped condition) — so the count is right even
 *  before the lazy grader has run. A time-stop close is NOT a stop. */
function ledgerRowStopped(r: GovernorLedgerRow): boolean {
  if (r.plan_outcome === "stopped") return true;
  if (r.status !== "CLOSED") return false;
  return (
    r.entry_premium != null &&
    r.entry_premium > 0 &&
    r.trough_premium != null &&
    r.trough_premium <= r.entry_premium * (1 + PLAN_RULES.stop_pct / 100)
  );
}

/** Deterministic snapshot from today's ledger rows (the shared-Postgres half). */
export function deriveGovernorFromLedger(rows: GovernorLedgerRow[]): GovernorSnapshot {
  const stops: GovernorStopEvent[] = [];
  const openPlans: GovernorOpenPlan[] = [];
  for (const r of rows) {
    if (r.status !== "CLOSED") openPlans.push({ ticker: r.ticker.toUpperCase(), direction: r.direction });
    if (ledgerRowStopped(r)) stops.push({ ticker: r.ticker.toUpperCase(), direction: r.direction, at_ms: null });
  }
  return { open_plans: openPlans, stops };
}

/** Union ledger-derived stops with Redis-recorded ones (per ticker). A recorded
 *  event wins because it carries the timestamp the re-entry lock needs; a ledger
 *  stop with no recorded twin stays timeless but still counts toward the halt. */
export function mergeGovernorStops(
  ledgerStops: GovernorStopEvent[],
  recorded: GovernorStopEvent[]
): GovernorStopEvent[] {
  const byTicker = new Map<string, GovernorStopEvent>();
  for (const s of ledgerStops) byTicker.set(s.ticker.toUpperCase(), { ...s, ticker: s.ticker.toUpperCase() });
  for (const s of recorded) {
    const t = s.ticker.toUpperCase();
    const existing = byTicker.get(t);
    if (!existing || (existing.at_ms == null && s.at_ms != null)) {
      byTicker.set(t, { ...s, ticker: t });
    }
  }
  return Array.from(byTicker.values());
}

/**
 * The pure G-5 verdict for one fresh candidate. `committedThisCycle` carries fresh
 * commits ALREADY accepted earlier in this same scan pass (setups arrive
 * score-ranked), so a single cycle can never blow through the concurrency cap — or
 * commit two correlated-but-opposed plans — against the same pre-cycle snapshot.
 *
 * Note on reachability: the ledger's (session_date, ticker) primary key already
 * prevents a second same-session commit on a stopped ticker, so the re-entry lock
 * is defense-in-depth today — it becomes load-bearing the moment re-entries exist
 * (and it is what the morning-gate checklist simulates).
 */
export function evaluateZeroDteGovernor(
  candidate: { ticker: string; direction: "long" | "short" },
  snap: GovernorSnapshot,
  nowMs: number,
  committedThisCycle: GovernorOpenPlan[] = []
): ZeroDteGateBlock[] {
  const blocks: ZeroDteGateBlock[] = [];

  // Session halt dominates — after 3 stops the answer is "no more today", full stop.
  if (snap.stops.length >= GOVERNOR_MAX_SESSION_STOPS) {
    blocks.push({
      code: "governor_session_stops",
      reason:
        `Session governor: ${snap.stops.length} plays stopped out today (max ${GOVERNOR_MAX_SESSION_STOPS}) — ` +
        "no new commits for the rest of the session. 7/13 took 7 uncapped stops; this is the ceiling.",
      threshold: GOVERNOR_MAX_SESSION_STOPS,
      unlock_et: null,
    });
    return blocks;
  }

  const liveExposure = [...snap.open_plans, ...committedThisCycle];

  if (liveExposure.length >= GOVERNOR_MAX_CONCURRENT_PLANS) {
    blocks.push({
      code: "governor_max_concurrent",
      reason:
        `Session governor: ${liveExposure.length} plans already live (max ` +
        `${GOVERNOR_MAX_CONCURRENT_PLANS} concurrent) — manage what's open before adding exposure.`,
      threshold: GOVERNOR_MAX_CONCURRENT_PLANS,
      unlock_et: null,
    });
  }

  // B-3 — correlated conflict: a new plan must not fight an OPEN plan on a
  // correlated instrument (7/13 ran SPY long + QQQ short at once — one guaranteed
  // loser). Direction AGREEMENT is fine; only opposition blocks.
  const candidateTicker = candidate.ticker.toUpperCase();
  const group = correlationGroupOf(candidateTicker);
  if (group) {
    const opposed = liveExposure.find(
      (p) =>
        p.ticker.toUpperCase() !== candidateTicker &&
        group.has(p.ticker.toUpperCase()) &&
        p.direction !== candidate.direction
    );
    if (opposed) {
      blocks.push({
        code: "correlated_conflict",
        reason:
          `Session governor: ${candidateTicker} ${candidate.direction} opposes the OPEN ` +
          `${opposed.ticker.toUpperCase()} ${opposed.direction} — correlated index/ETF exposure ` +
          "in both directions is one guaranteed loser (7/13 ran SPY long + QQQ short simultaneously).",
        threshold: null,
        unlock_et: null,
      });
    }
  }

  const ticker = candidate.ticker.toUpperCase();
  for (const s of snap.stops) {
    if (
      s.ticker === ticker &&
      s.direction === candidate.direction &&
      s.at_ms != null &&
      nowMs - s.at_ms < GOVERNOR_REENTRY_LOCK_MS
    ) {
      const minsLeft = Math.ceil((GOVERNOR_REENTRY_LOCK_MS - (nowMs - s.at_ms)) / 60_000);
      blocks.push({
        code: "governor_reentry_lock",
        reason:
          `Session governor: ${ticker} ${candidate.direction} stopped out under 20 minutes ago — ` +
          `same-direction re-entry locked for ~${minsLeft} more minute${minsLeft === 1 ? "" : "s"}.`,
        threshold: GOVERNOR_REENTRY_LOCK_MS / 60_000,
        unlock_et: null,
      });
      break;
    }
  }

  return blocks;
}

// ── Redis-backed stop-event record (shared across replicas) ───────────────────────

const governorStopsKey = (sessionDate: string) => `zerodte:governor:stops:${sessionDate}`;
/** Session state only needs to outlive the trading day; 24h TTL self-cleans. */
const GOVERNOR_STATE_TTL_SEC = 24 * 60 * 60;

type RecordedStop = { ticker: string; direction: "long" | "short"; at_ms: number };

/** Read the session's recorded stop events. Empty array on any failure — the
 *  ledger-derived stops (Postgres) remain the authoritative halt count, so a cold/
 *  down Redis can only soften the timed re-entry lock, never lift a halt. */
export async function loadRecordedGovernorStops(sessionDate: string): Promise<GovernorStopEvent[]> {
  try {
    const raw = await sharedCacheGet<RecordedStop[]>(governorStopsKey(sessionDate));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s) =>
          s &&
          typeof s.ticker === "string" &&
          (s.direction === "long" || s.direction === "short") &&
          Number.isFinite(s.at_ms)
      )
      .map((s) => ({ ticker: s.ticker.toUpperCase(), direction: s.direction, at_ms: s.at_ms }));
  } catch {
    return [];
  }
}

/**
 * Record newly-observed stop transitions (called by scan.ts's syncLedgerLiveState
 * when a row flips to CLOSED/stopped). First-write-wins per ticker: a stop time,
 * once recorded, is never overwritten by a later observation of the same (already
 * stopped) row — the lock must measure from the FIRST sighting.
 */
export async function recordGovernorStops(
  sessionDate: string,
  events: RecordedStop[]
): Promise<void> {
  if (events.length === 0) return;
  const existing = await loadRecordedGovernorStops(sessionDate);
  const byTicker = new Map<string, GovernorStopEvent>(existing.map((s) => [s.ticker, s]));
  let changed = false;
  for (const e of events) {
    const t = e.ticker.toUpperCase();
    if (byTicker.has(t)) continue;
    byTicker.set(t, { ticker: t, direction: e.direction, at_ms: e.at_ms });
    changed = true;
  }
  if (!changed) return;
  await sharedCacheSet(
    governorStopsKey(sessionDate),
    Array.from(byTicker.values()),
    GOVERNOR_STATE_TTL_SEC
  );
}
