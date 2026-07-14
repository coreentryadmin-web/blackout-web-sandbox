/**
 * Vector ALERTS engine (task #19, slice 1 — pure evaluation core). Detects the two events a member
 * most wants a ping for: price TOUCHING a dealer wall, and price CROSSING the gamma flip. Kept pure
 * and dependency-free (no Date.now, no fetch — `nowMs` + spots are passed in) so the firing logic is
 * deterministic and unit-testable; the in-page delivery (toast + terminal + rule UI) and the later
 * Web-Push layer live outside this module.
 *
 * The hard part isn't detection, it's NOT SPAMMING: on a live tape spot ticks through a wall's
 * tolerance band many times a second. So each rule carries a small state machine — it fires on the
 * RISING EDGE (outside→inside the band, or a genuine flip sign-change), then stays quiet until the
 * condition CLEARS (spot leaves a wider exit band / crosses back) AND a cooldown elapses. That gives
 * "one ping per real approach", not one per tick.
 */

export type AlertKind = "wall-touch" | "flip-cross";

export type AlertRule = {
  id: string;
  ticker: string;
  kind: AlertKind;
  /** wall-touch only: how close to a strike counts as a touch, as a fraction of spot. Default 0.1%. */
  tolerancePct?: number;
  enabled: boolean;
};

export type AlertWalls = {
  callWalls?: ReadonlyArray<{ strike: number }>;
  putWalls?: ReadonlyArray<{ strike: number }>;
};

export type AlertContext = {
  spot: number;
  /** Previous evaluated spot — needed to detect a flip CROSS (sign change). null on the first tick. */
  priorSpot: number | null;
  walls: AlertWalls | null;
  flip: number | null;
  /** Caller-supplied clock (pure module — no Date.now). */
  nowMs: number;
};

export type FiredAlert = {
  ruleId: string;
  ticker: string;
  kind: AlertKind;
  /** The wall strike touched, or the flip level crossed. */
  level: number;
  /** "up" | "down" for a flip cross; the touch side for a wall. */
  direction: "up" | "down";
  spot: number;
  at: number;
  message: string;
};

/** Per-rule firing state (opaque to callers; persist across ticks, seed with `{}`). */
export type AlertRuleState = {
  /** True once the condition has cleared and the rule is ready to fire again. */
  armed: boolean;
  lastFiredMs: number;
  /** The level (strike/flip) the last fire referenced — lets a NEW nearest-wall re-fire immediately. */
  lastLevel: number | null;
};

export type AlertState = Record<string, AlertRuleState>;

/** Minimum gap between two fires of the SAME rule, even across separate approaches. */
export const ALERT_COOLDOWN_MS = 60_000;
const DEFAULT_WALL_TOL_PCT = 0.001; // 0.1% of spot
/** Exit band is wider than the entry band (hysteresis) so spot hovering at the edge can't flap. */
const EXIT_BAND_MULT = 1.8;

function seed(state: AlertState, id: string): AlertRuleState {
  return state[id] ?? { armed: true, lastFiredMs: -Infinity, lastLevel: null };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Nearest wall strike to spot across both sides, with its side, or null when there are no walls. */
function nearestWall(walls: AlertWalls | null, spot: number): { strike: number; side: "call" | "put" } | null {
  let best: { strike: number; side: "call" | "put" } | null = null;
  let bestDist = Infinity;
  for (const w of walls?.callWalls ?? []) {
    if (!Number.isFinite(w.strike)) continue;
    const d = Math.abs(w.strike - spot);
    if (d < bestDist) { bestDist = d; best = { strike: w.strike, side: "call" }; }
  }
  for (const w of walls?.putWalls ?? []) {
    if (!Number.isFinite(w.strike)) continue;
    const d = Math.abs(w.strike - spot);
    if (d < bestDist) { bestDist = d; best = { strike: w.strike, side: "put" }; }
  }
  return best;
}

/**
 * Evaluate every enabled rule against the current tick. Returns the alerts that FIRED this tick and
 * the NEXT state (pure — the caller persists `state` across ticks). A rule fires at most once per
 * tick; the rising-edge + cooldown + hysteresis logic guarantees one ping per genuine approach/cross.
 */
export function evaluateAlerts(
  rules: readonly AlertRule[],
  ctx: AlertContext,
  state: AlertState
): { fired: FiredAlert[]; state: AlertState } {
  const fired: FiredAlert[] = [];
  const next: AlertState = { ...state };
  const { spot, priorSpot, walls, flip, nowMs } = ctx;
  if (!(spot > 0)) return { fired, state: next };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const rs = { ...seed(state, rule.id) };

    if (rule.kind === "wall-touch") {
      const near = nearestWall(walls, spot);
      if (!near) { next[rule.id] = rs; continue; }
      const tol = spot * (rule.tolerancePct ?? DEFAULT_WALL_TOL_PCT);
      const dist = Math.abs(near.strike - spot);
      const inEntry = dist <= tol;
      const outExit = dist > tol * EXIT_BAND_MULT;

      // Re-arm when the condition clears — either spot left the (wider) exit band of the SAME wall,
      // or the nearest wall is now a DIFFERENT strike than we last fired on (a fresh event). The
      // per-rule cooldown still bounds the fire rate, so re-arming on a wall-switch can't spam.
      if (outExit || (rs.lastLevel != null && near.strike !== rs.lastLevel)) rs.armed = true;

      if (inEntry && rs.armed && nowMs - rs.lastFiredMs >= ALERT_COOLDOWN_MS) {
        rs.armed = false;
        rs.lastFiredMs = nowMs;
        rs.lastLevel = near.strike;
        fired.push({
          ruleId: rule.id, ticker: rule.ticker, kind: "wall-touch",
          level: near.strike, direction: near.side === "call" ? "up" : "down",
          spot, at: nowMs,
          message: `${rule.ticker} testing ${near.side} wall ${fmt(near.strike)} (spot ${fmt(spot)})`,
        });
      }
      next[rule.id] = rs;
      continue;
    }

    // flip-cross: a genuine sign change of (spot − flip) vs the prior spot.
    if (rule.kind === "flip-cross") {
      if (flip == null || priorSpot == null) { next[rule.id] = rs; continue; }
      const prevSide = Math.sign(priorSpot - flip);
      const curSide = Math.sign(spot - flip);
      const crossed = prevSide !== 0 && curSide !== 0 && prevSide !== curSide;
      if (!crossed) { rs.armed = true; next[rule.id] = rs; continue; }
      if (rs.armed && nowMs - rs.lastFiredMs >= ALERT_COOLDOWN_MS) {
        rs.armed = false;
        rs.lastFiredMs = nowMs;
        rs.lastLevel = flip;
        const dir = curSide > 0 ? "up" : "down";
        fired.push({
          ruleId: rule.id, ticker: rule.ticker, kind: "flip-cross",
          level: flip, direction: dir, spot, at: nowMs,
          message: `${rule.ticker} crossed the gamma flip ${fmt(flip)} ${dir === "up" ? "upward → long-gamma" : "downward → short-gamma"} (spot ${fmt(spot)})`,
        });
      }
      next[rule.id] = rs;
      continue;
    }
  }

  return { fired, state: next };
}

/** Stable id for a new rule (caller passes a counter/seed — pure, no randomness). */
export function alertRuleId(ticker: string, kind: AlertKind, seedNum: number): string {
  return `${ticker}:${kind}:${seedNum}`;
}
