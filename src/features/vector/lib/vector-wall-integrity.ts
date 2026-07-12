import type { GexWalls, GexWallLevel } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "./vector-wall-history";

/**
 * Wall integrity / confidence — "is this wall real, or a thin level about to fold?"
 *
 * A member staring at beads can't tell a wall that has held all session and towers
 * over its neighbors from one that just appeared and sits in a mushy cluster. Both
 * render as a bead. This scores the difference from data the client already has —
 * no server plumbing — so it never over-trusts a thin wall.
 *
 * Three honest, independent factors (each normalized 0–1), blended:
 *  - STRENGTH (0.45): the wall's own net-gamma share (`pct`) — the raw size of the
 *    dealer gamma parked there. The dominant driver.
 *  - PERSISTENCE (0.35): the fraction of recent history-rail samples in which this
 *    strike showed up as a wall on its side. A level defended all session is far more
 *    trustworthy than one that blinked into existence this minute. Needs the rail;
 *    with no history it's neutral (0.5), never fabricated as "proven."
 *  - ISOLATION (0.20): how far the wall towers over the NEXT wall on its side
 *    ((this.pct − next.pct)/this.pct). A clean, isolated level is a real line; one
 *    inside a cluster of equals is diffuse. Single-wall side → fully isolated (1).
 *
 * Weights favor raw strength but let a persistent, dominant level earn "firm" and
 * knock a big-but-fleeting-and-clustered one down — which is the whole point.
 */

export type WallIntegrityTier = "firm" | "moderate" | "thin";

export type WallIntegrity = {
  strike: number;
  side: "call" | "put";
  /** 0–100 confidence. */
  score: number;
  tier: WallIntegrityTier;
  factors: { strength: number; persistence: number; isolation: number };
  /** Compact desk-terminal phrasing. */
  note: string;
};

const W_STRENGTH = 0.45;
const W_PERSISTENCE = 0.35;
const W_ISOLATION = 0.2;

/** Strikes within this distance are treated as the same level across rail samples. */
const STRIKE_MATCH_TOL = 1.0;
/** How many trailing rail samples define "recent" for persistence. */
const PERSISTENCE_WINDOW = 60;
/**
 * Fewer rail samples than this = no meaningful time series yet, so persistence is
 * "unknown" (neutral 0.5), NOT "proven." This matters off-hours for a ticker with no
 * recorded rail: seedWallHistoryForDisplay drops a SINGLE as-of-close sample, and a
 * one-sample rail made every wall read "held 100% of session" — an overclaim, since
 * nothing was actually observed holding over time. Below the floor we say "as-of-close."
 */
const MIN_RAIL_SAMPLES = 3;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function tierFor(score: number): WallIntegrityTier {
  return score >= 70 ? "firm" : score >= 45 ? "moderate" : "thin";
}

function persistenceFor(
  strike: number,
  side: "call" | "put",
  history: readonly WallHistorySample[]
): number {
  if (history.length < MIN_RAIL_SAMPLES) return 0.5; // seed/near-empty rail — unknown ≠ proven
  const recent = history.slice(-PERSISTENCE_WINDOW);
  let hits = 0;
  for (const sample of recent) {
    const levels = side === "call" ? sample.walls.callWalls : sample.walls.putWalls;
    if (levels.some((l) => Math.abs(l.strike - strike) <= STRIKE_MATCH_TOL)) hits += 1;
  }
  return recent.length ? hits / recent.length : 0.5;
}

/**
 * Score one wall against its same-side peers + the history rail.
 *
 * `refMaxPct` is the strongest wall's `pct` across BOTH sides — the normalizer for
 * the strength factor. This matters because `pct` is a wall's share of the WHOLE
 * chain's gamma (`|g| / totalAbsGamma`), so even the dominant wall is only a few
 * percent when gamma is spread across ~20 strikes. Dividing by a flat 100 made the
 * strength factor effectively dead (~0.05), so every wall collapsed to ~persistence
 * alone and a level that held all session still read "thin". Normalizing against the
 * strongest present wall gives the dominant level its due (strength → 1.0) while a
 * genuinely weak, clustered wall still scores low.
 */
export function scoreWallIntegrity(
  wall: GexWallLevel,
  side: "call" | "put",
  sideWalls: readonly GexWallLevel[],
  history: readonly WallHistorySample[],
  refMaxPct: number
): WallIntegrity | null {
  if (!wall || !(wall.strike > 0) || !(wall.pct >= 0)) return null;

  const strength = refMaxPct > 0 ? clamp01(wall.pct / refMaxPct) : 0;
  const persistence = persistenceFor(wall.strike, side, history);

  // Isolation: gap to the strongest OTHER wall on this side.
  const others = sideWalls.filter((l) => Math.abs(l.strike - wall.strike) > STRIKE_MATCH_TOL);
  const nextPct = others.length ? Math.max(...others.map((l) => l.pct)) : 0;
  const isolation = wall.pct > 0 ? clamp01((wall.pct - nextPct) / wall.pct) : 0;

  const score = Math.round(
    100 * (W_STRENGTH * strength + W_PERSISTENCE * persistence + W_ISOLATION * isolation)
  );
  const tier = tierFor(score);

  return {
    strike: wall.strike,
    side,
    score,
    tier,
    factors: {
      strength: round2(strength),
      persistence: round2(persistence),
      isolation: round2(isolation),
    },
    note: buildNote(side, wall.strike, tier, persistence, isolation, history.length),
  };
}

/** Integrity of the top call + top put wall — the two levels the desk reads first. */
export function scoreTopWalls(
  walls: GexWalls | null | undefined,
  history: readonly WallHistorySample[] = []
): { call: WallIntegrity | null; put: WallIntegrity | null } {
  // Strength normalizer = the strongest wall's share across BOTH sides, so the
  // dominant level anchors strength at 1.0 and the score isn't crushed by the fact
  // that any single strike is only a few % of the whole chain's gamma.
  const refMaxPct = Math.max(
    0,
    ...(walls?.callWalls ?? []).map((w) => w.pct),
    ...(walls?.putWalls ?? []).map((w) => w.pct)
  );
  const call = walls?.callWalls?.length
    ? scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, history, refMaxPct)
    : null;
  const put = walls?.putWalls?.length
    ? scoreWallIntegrity(walls.putWalls[0]!, "put", walls.putWalls, history, refMaxPct)
    : null;
  return { call, put };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildNote(
  side: "call" | "put",
  strike: number,
  tier: WallIntegrityTier,
  persistence: number,
  isolation: number,
  historyLen: number
): string {
  const held =
    historyLen === 0
      ? "no rail yet"
      : historyLen < MIN_RAIL_SAMPLES
        ? "as-of-close" // seed/near-empty rail — no session-long observation to claim
        : `held ${Math.round(persistence * 100)}% of session`;
  const shape = isolation >= 0.5 ? "dominant" : "clustered";
  return `${Math.round(strike)}${side === "call" ? "C" : "P"} ${tier} — ${held}, ${shape}`;
}
