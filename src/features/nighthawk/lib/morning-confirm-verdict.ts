// Night Hawk morning-confirm verdict engine — extracted from the cron route so it is
// unit-testable (Next.js route files may not export helpers) and so the status union
// has one home. Pure function: all market/stock context is injected.
import type { PlaybookPlay } from "./types";
import { parsePlayLevels } from "./play-levels";

export type PlayConfirmStatus = "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED";

export type PlayStatus = {
  rank: number;
  ticker: string;
  direction: string;
  status: PlayConfirmStatus;
  reason: string;
  // ── PR-N6/N7 overnight axes (ADDITIVE, all OPTIONAL) ──────────────────────────────
  // Optional so old cached play-status blobs (written before N6/N7) deserialize cleanly
  // and the play-status route stays 200 for a not-yet-run/legacy edition. `status`/`reason`
  // above already fold in any downgrade these caused — these fields are the EVIDENCE for it.
  /** PR-N6 thesis-drift: per pinned-source held/weakened/flipped + aggregate verdict. */
  thesisDrift?: import("./thesis-drift").SourceDrift[];
  thesisVerdict?: import("./thesis-drift").ThesisVerdict;
  /** PR-N7: the pinned invalidators that FIRED against the morning state (id + reason). */
  invalidatorsFired?: Array<{ id: string; severity: "kill" | "degrade"; detail: string }>;
};

// Severity rank for the CONFIRMED→INVALIDATED axis. UNVERIFIED is a statement about DATA,
// not the play, so it lives OFF this scale (worsenPlayStatus leaves it untouched).
const STATUS_RANK: Record<Exclude<PlayConfirmStatus, "UNVERIFIED">, number> = {
  CONFIRMED: 0,
  DEGRADED: 1,
  INVALIDATED: 2,
};

/**
 * Compose the price verdict with the overnight axes' implied status, ONE-WAY: return the
 * WORSE of the two, never an upgrade. PR-N6/N7 — thesis-drift and fired invalidators can
 * only degrade/invalidate a play, matching the repo's one-way-latch philosophy.
 *
 * UNVERIFIED is preserved as-is: it means no pre-market data was reachable, in which case
 * the overnight axes had no morning spot to fire on anyway — dressing that in a downgrade
 * would imply a check ran that did not.
 */
export function worsenPlayStatus(
  base: PlayConfirmStatus,
  axis: PlayConfirmStatus | null
): PlayConfirmStatus {
  if (axis == null) return base;
  if (base === "UNVERIFIED") return base;
  if (axis === "UNVERIFIED") return base;
  return STATUS_RANK[axis] > STATUS_RANK[base] ? axis : base;
}

// Overnight gap threshold: > this many SPX points (absolute) = significant gap.
export const GAP_PTS_THRESHOLD = 20;
// GEX wall shift that degrades a play relying on that wall.
const WALL_SHIFT_SOFT_PTS = 10;
const WALL_SHIFT_HARD_PTS = 30;

// The verdict is a ONE-TIME pre-market snapshot (cron fires 9:10-9:45 ET, then the
// blob sits in Redis with a 24h TTL) — it is never re-evaluated against live price
// action. Live repro: a TSLA DEGRADED badge computed at 9:16 ET was still displayed
// unchanged at 14:49 ET, 5.5h later, with no indication it was stale (audit P3). The
// badge itself can't be made live without re-architecting the cron into a poller, so
// instead the UI must stop presenting a frozen 9am judgment as if it were current.
export const MORNING_CONFIRM_STALE_MS = 4 * 60 * 60 * 1000; // 4h — flags by ~early afternoon

/** True once a morning-confirm verdict is old enough that showing it without an
 *  "as of" qualifier would mislead a member into treating a 9am snapshot as live. */
export function isMorningConfirmStale(checkedAt: string | null | undefined, nowMs: number): boolean {
  if (!checkedAt) return false;
  const checkedMs = Date.parse(checkedAt);
  if (Number.isNaN(checkedMs)) return false;
  return nowMs - checkedMs > MORNING_CONFIRM_STALE_MS;
}

/** Format an ISO timestamp as Eastern clock time for the badge tooltip, e.g. "9:16 AM ET". */
export function formatCheckedAtEt(checkedAt: string): string {
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${clock} ET`;
}

export function computePlayVerdict(
  play: PlaybookPlay,
  context: {
    gapPts: number | null;
    regime: string | null;
    anomalies: Array<{ direction?: string; [key: string]: unknown }>;
    callWall: number | null;
    putWall: number | null;
    editionCallWall: number | null;
    editionPutWall: number | null;
    /** The play's OWN pre-market price (Polygon stock snapshot). null = unavailable. */
    stockPremarket?: number | null;
  }
): PlayStatus {
  const { gapPts, regime, anomalies, callWall, putWall, editionCallWall, editionPutWall } = context;
  const direction = play.direction?.toUpperCase() ?? "LONG";
  const isLong = direction === "LONG" || direction === "BUY" || direction === "BULL";

  const reasons: string[] = [];
  let status: PlayConfirmStatus = "CONFIRMED";
  // Count checks that actually EVALUATED (had data). Zero evaluated checks must not
  // read as CONFIRMED — the old code initialized CONFIRMED and only ever downgraded,
  // so a total intel/Polygon outage produced a full slate of green "All checks
  // passed" badges built on nothing (audit HIGH).
  let checksEvaluated = 0;

  // ── 0. The play's OWN pre-market price vs its published levels ────────────
  // Strongest evidence there is: the audit's core gap was that only the SPX INDEX
  // was checked, so a stock that gapped clean through its own stop (or target)
  // on stock-specific news still confirmed.
  const stockPx = context.stockPremarket ?? null;
  if (stockPx != null && stockPx > 0) {
    const { entry_range_high: entryHi, entry_range_low: entryLo, target, stop } = parsePlayLevels(play);
    if (target != null || stop != null || entryHi != null) checksEvaluated++;
    if (stop != null && (isLong ? stockPx <= stop : stockPx >= stop)) {
      status = "INVALIDATED";
      reasons.push(`${play.ticker} pre-market ${stockPx.toFixed(2)} has gapped through the stop (${stop})`);
    } else if (target != null && (isLong ? stockPx >= target : stockPx <= target)) {
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(`${play.ticker} pre-market ${stockPx.toFixed(2)} already at/through target (${target}) — reward consumed pre-open`);
    } else if (
      isLong
        ? entryHi != null && stockPx > entryHi * 1.005
        : entryLo != null && stockPx < entryLo * 0.995
    ) {
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(
        `${play.ticker} pre-market ${stockPx.toFixed(2)} gapped ${isLong ? "above" : "below"} the entry range — do not chase the published entry`
      );
    }
  }

  // ── Hard invalidation checks ──────────────────────────────────────────────

  // 1. Gap against the play's direction
  if (gapPts !== null) checksEvaluated++;
  if (gapPts !== null && Math.abs(gapPts) > GAP_PTS_THRESHOLD) {
    const gapAgainst = isLong ? gapPts < -GAP_PTS_THRESHOLD : gapPts > GAP_PTS_THRESHOLD;
    if (gapAgainst) {
      status = "INVALIDATED";
      reasons.push(`SPX gapped ${gapPts > 0 ? "+" : ""}${gapPts.toFixed(1)} pts against ${direction} direction`);
    }
  }

  // 2. Contrary anomalies
  if (regime !== null || anomalies.length > 0) checksEvaluated++;
  const contraryAnomalies = anomalies.filter((a) => {
    const aDir = (a.direction ?? "").toUpperCase();
    if (!aDir) return false;
    const aBear = aDir.includes("BEAR") || aDir.includes("PUT") || aDir.includes("SHORT");
    const aBull = aDir.includes("BULL") || aDir.includes("CALL") || aDir.includes("LONG");
    return isLong ? aBear : aBull;
  });
  if (contraryAnomalies.length > 0 && status !== "INVALIDATED") {
    // A single strong contrary anomaly degrades; multiple hard-invalidate
    if (contraryAnomalies.length >= 2) {
      status = "INVALIDATED";
      reasons.push(`${contraryAnomalies.length} contrary flow anomalies detected`);
    } else {
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(`Contrary flow anomaly detected — reduce size`);
    }
  }

  // 3. GEX wall shifted hard (> WALL_SHIFT_HARD_PTS) vs edition levels
  if ((editionCallWall !== null && callWall !== null) || (editionPutWall !== null && putWall !== null)) {
    checksEvaluated++;
  }
  if (editionCallWall !== null && callWall !== null) {
    const callShift = Math.abs(callWall - editionCallWall);
    if (callShift > WALL_SHIFT_HARD_PTS && !isLong) {
      // Call wall that shifted hard affects SHORT plays (call wall is SHORT's target / resistance)
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(`Call wall shifted ${callShift.toFixed(0)} pts from edition (${editionCallWall} → ${callWall})`);
    }
  }
  if (editionPutWall !== null && putWall !== null) {
    const putShift = Math.abs(putWall - editionPutWall);
    if (putShift > WALL_SHIFT_HARD_PTS && isLong) {
      // Put wall shifted hard affects LONG plays (put wall is LONG's stop / support)
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(`Put wall shifted ${putShift.toFixed(0)} pts from edition (${editionPutWall} → ${putWall})`);
    }
  }

  // ── Degraded checks (only if not already invalidated) ────────────────────

  if (status !== "INVALIDATED") {
    // 4. Gap in same direction — may run stops / change R:R
    if (gapPts !== null && Math.abs(gapPts) > GAP_PTS_THRESHOLD) {
      if (status === "CONFIRMED") status = "DEGRADED";
      reasons.push(`SPX gapped ${gapPts > 0 ? "+" : ""}${gapPts.toFixed(1)} pts — verify entry levels, stop may be unsafe`);
    }

    // 5. Regime mismatch (non-null regime check)
    if (regime !== null) {
      const regimeLower = regime.toLowerCase();
      const isChoppy = regimeLower.includes("chop") || regimeLower.includes("neutral");
      const isBearRegime = regimeLower.includes("bear") || regimeLower.includes("down");
      const isBullRegime = regimeLower.includes("bull") || regimeLower.includes("up");
      if (isChoppy) {
        if (status === "CONFIRMED") status = "DEGRADED";
        reasons.push(`Regime is ${regime} — choppy/neutral reduces conviction for directional plays`);
      } else if (isLong && isBearRegime) {
        status = "INVALIDATED";
        reasons.push(`Regime flipped to ${regime} — contradicts LONG direction`);
      } else if (!isLong && isBullRegime) {
        status = "INVALIDATED";
        reasons.push(`Regime is ${regime} — contradicts SHORT direction`);
      }
    }

    // 6. Soft GEX wall drift (WALL_SHIFT_SOFT_PTS < shift ≤ WALL_SHIFT_HARD_PTS)
    if (editionCallWall !== null && callWall !== null) {
      const callShift = Math.abs(callWall - editionCallWall);
      if (callShift > WALL_SHIFT_SOFT_PTS && callShift <= WALL_SHIFT_HARD_PTS) {
        if (status === "CONFIRMED") status = "DEGRADED";
        reasons.push(`Call wall drifted ${callShift.toFixed(0)} pts (${editionCallWall} → ${callWall}) — tighten target`);
      }
    }
    if (editionPutWall !== null && putWall !== null) {
      const putShift = Math.abs(putWall - editionPutWall);
      if (putShift > WALL_SHIFT_SOFT_PTS && putShift <= WALL_SHIFT_HARD_PTS) {
        if (status === "CONFIRMED") status = "DEGRADED";
        reasons.push(`Put wall drifted ${putShift.toFixed(0)} pts (${editionPutWall} → ${putWall}) — tighten stop`);
      }
    }

    // 7. Any anomaly (even same-direction) — flag as degraded if none caught above
    if (anomalies.length > 0 && status === "CONFIRMED") {
      status = "DEGRADED";
      reasons.push(`${anomalies.length} active flow anomaly(ies) — elevated uncertainty, reduce size`);
    }
  }

  // Zero checks ran → the verdict is a statement about DATA, not the play. Do not
  // dress it in green: UNVERIFIED tells the member "the desk could not check this
  // one" instead of "this one passed every check".
  if (checksEvaluated === 0) {
    return {
      rank: play.rank,
      ticker: play.ticker,
      direction: play.direction,
      status: "UNVERIFIED",
      reason: "No pre-market data reachable (intel + Polygon unavailable) — verdict withheld, treat as unvetted",
    };
  }

  return {
    rank: play.rank,
    ticker: play.ticker,
    direction: play.direction,
    status,
    reason: reasons.length > 0 ? reasons.join("; ") : "All checks passed",
  };
}
