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
};

// Overnight gap threshold: > this many SPX points (absolute) = significant gap.
export const GAP_PTS_THRESHOLD = 20;
// GEX wall shift that degrades a play relying on that wall.
const WALL_SHIFT_SOFT_PTS = 10;
const WALL_SHIFT_HARD_PTS = 30;

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
