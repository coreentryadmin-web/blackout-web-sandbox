// PR-N4 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md N-7): persist the 9:15 ET
// morning-confirm verdicts durably, and make INVALIDATED BINDING.
//
// Before this, a verdict lived only in a 24h-TTL Redis blob + a Discord ping: the record's
// only A+ play (AMD 2026-07-07) gapped −6.55% through its published stop pre-market, was
// INVALIDATED-knowable at 9:15, stayed fully tradeable on the board all day, and booked
// −6.59% — and by the next morning the verdict itself had evaporated, so "how predictive
// is DEGRADED?" was unanswerable (the 0DTE C-2 gap, replayed).
//
// What persists, per play, onto its nighthawk_play_outcomes row:
//  - `morning_verdict` JSONB: status + reasons + the NUMBERS the check actually saw
//    (pre-market spot, gap pts/pct, spot-vs-stop/-band distances, regime) — only values
//    the cron really computed; unavailable inputs persist as null, never fabricated.
//    First-write-wins at the DB layer (COALESCE): the 9:15 read is the calibration datum.
//  - INVALIDATED ⇒ the ONE-WAY `pulled` latch (recordNighthawkMorningVerdict): the play is
//    presented as PULLED on the member surface and its grade becomes counterfactual-only.
//    DEGRADED stays advisory (label only) — enforcement thresholds are a calibration
//    decision deferred to N6, made possible by exactly this table of persisted verdicts.
//
// FAIL-SOFT: persistNighthawkMorningVerdicts never throws. The Redis blob (kept — the UI
// badge reads it today) is written by the caller regardless; a DB failure here costs the
// durable copy for that run and is reported in the cron payload, never a dead cron.

import type { PlayStatus } from "./morning-confirm-verdict";
import type { PlaybookPlay } from "./types";
import { parsePlayLevels } from "./play-levels";
import { recordNighthawkMorningVerdict } from "@/lib/db";

/** Bump when the persisted verdict shape changes so calibration reads can segment. */
export const MORNING_VERDICT_VERSION = 2;

// PR-N6: DEGRADED becomes binding when multiple independent signals fire. A single
// "reduce size" stays advisory (a reasoned caution, not an actionable defect);
// ≥2 distinct degradation reasons means the play's premise is compromised on multiple
// axes and the honest call is to pull rather than badge.
export const DEGRADED_SEVERE_REASON_COUNT = 2;

/** True when a DEGRADED verdict is severe enough to engage the pull latch (PR-N6).
 *  Severity = count of distinct reasons (semicolon-separated in PlayStatus.reason). */
export function isDegradedSevere(status: PlayStatus): boolean {
  if (status.status !== "DEGRADED") return false;
  const reasons = status.reason.split(";").map((r) => r.trim()).filter(Boolean);
  return reasons.length >= DEGRADED_SEVERE_REASON_COUNT;
}

export type MorningVerdictMarketContext = {
  /** SPX pre-market − prior close, points. Null when either side was unreachable. */
  gapPts: number | null;
  spxPremarket: number | null;
  spxPriorClose: number | null;
  regime: string | null;
  /** Per-ticker pre-market snapshot prices (UPPERCASED keys). */
  stockPremarketByTicker: Record<string, number | null>;
};

function pct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === 0) {
    return null;
  }
  return Math.round(((to - from) / from) * 100 * 10_000) / 10_000;
}

/** The durable JSONB blob for one play's verdict — pure, so the numbers-it-saw contract
 *  is unit-testable without Redis/PG/Polygon. */
export function buildMorningVerdictRecord(opts: {
  status: PlayStatus;
  play: PlaybookPlay | undefined;
  checkedAt: string;
  market: MorningVerdictMarketContext;
}): Record<string, unknown> {
  const { status, play, checkedAt, market } = opts;
  const levels = play ? parsePlayLevels(play) : { entry_range_low: null, entry_range_high: null, target: null, stop: null };
  const premarket = market.stockPremarketByTicker[status.ticker.toUpperCase()] ?? null;
  const isLong = !String(status.direction ?? "LONG").toUpperCase().includes("SHORT");
  // The fillable band edge, same convention as publish-context.ts (LONG: band top).
  const fillEdge = isLong ? levels.entry_range_high : levels.entry_range_low;
  return {
    verdict_version: MORNING_VERDICT_VERSION,
    status: status.status,
    reason: status.reason,
    checked_at: checkedAt,
    metrics: {
      stock_premarket: premarket,
      spx_premarket: market.spxPremarket,
      spx_prior_close: market.spxPriorClose,
      overnight_gap_pts: market.gapPts,
      overnight_gap_pct: pct(market.spxPriorClose, market.spxPremarket),
      regime: market.regime,
      // The published levels the verdict was judged against (re-parsed with the same
      // parser the grader uses) + where pre-market sat relative to them.
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      premarket_vs_stop_pct: pct(levels.stop, premarket),
      premarket_vs_band_pct: pct(fillEdge, premarket),
    },
  };
}

export type PersistMorningVerdictsResult = {
  ok: boolean;
  persisted: number;
  /** Rows that already carried a verdict (first-write-wins left them untouched). */
  already_recorded: number;
  /** Plays with NO outcome row to write to (publish-time sync failed for them). */
  missing_rows: number;
  /** Plays now latched pulled (this run or a prior one). */
  pulled: number;
  errors: string[];
};

export type PersistMorningVerdictDeps = {
  /** Prod: recordNighthawkMorningVerdict (db.ts) — COALESCE verdict + one-way pull latch. */
  record: typeof recordNighthawkMorningVerdict;
};

/**
 * Persist every play's verdict for one edition. INVALIDATED and severe-DEGRADED
 * (PR-N6: ≥2 distinct reasons) engage the pull latch; lighter statuses persist as
 * label-only. Never throws; per-play failures land in `errors` and the rest proceeds.
 */
export async function persistNighthawkMorningVerdicts(
  opts: {
    editionFor: string;
    checkedAt: string;
    playStatuses: PlayStatus[];
    plays: PlaybookPlay[];
    market: MorningVerdictMarketContext;
  },
  deps: Partial<PersistMorningVerdictDeps> = {}
): Promise<PersistMorningVerdictsResult> {
  const result: PersistMorningVerdictsResult = {
    ok: true,
    persisted: 0,
    already_recorded: 0,
    missing_rows: 0,
    pulled: 0,
    errors: [],
  };
  const record = deps.record ?? recordNighthawkMorningVerdict;
  const playByTicker = new Map(opts.plays.map((p) => [String(p.ticker ?? "").toUpperCase(), p]));

  for (const status of opts.playStatuses) {
    try {
      const verdict = buildMorningVerdictRecord({
        status,
        play: playByTicker.get(status.ticker.toUpperCase()),
        checkedAt: opts.checkedAt,
        market: opts.market,
      });
      const invalidated = status.status === "INVALIDATED";
      // PR-N6: severe DEGRADED (≥2 independent degradation reasons) also pulls.
      const degradedSevere = isDegradedSevere(status);
      const shouldPull = invalidated || degradedSevere;
      const res = await record({
        edition_for: opts.editionFor,
        ticker: status.ticker,
        verdict,
        pull: shouldPull,
        pull_reason: shouldPull
          ? `Pulled pre-open${degradedSevere ? " (severe degradation)" : ""}: ${status.reason}`
          : null,
      });
      if (!res.matched) {
        result.missing_rows += 1;
        continue;
      }
      if (res.verdict_written) result.persisted += 1;
      else result.already_recorded += 1;
      if (res.pulled) result.pulled += 1;
    } catch (err) {
      result.errors.push(
        `${status.ticker}@${opts.editionFor}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
