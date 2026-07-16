/**
 * Vector Pulse — pure logic layer for the live signal feed that replaces the desk terminal.
 *
 * Architecture follows the SPX Live Voice pattern exactly: snapshot → diff → cooldown dedup.
 * The chart's existing callbacks (regime, proximity, magnet, wall integrity, wall events)
 * provide the structured data; this module detects TRANSITIONS across consecutive ticks and
 * emits keyed signals for the UI feed. Pure, deterministic, no I/O, no Date.now().
 *
 * Signal kinds (priority order):
 *  1. regime-flip    — gamma posture change (long↔short↔transition)
 *  2. wall-structure — wall shift/build/fade/break events (passthrough from VectorChart)
 *  3. proximity      — spot approaching/testing/at a key level, or leaving proximity
 *  4. magnet-shift   — dealer hedging center of mass crossed spot
 *  5. integrity      — wall confidence tier changed (firm↔moderate↔thin)
 */

import type { VectorRegime, VectorRegimePosture } from "./vector-regime";
import type { WallProximity, WallProximitySide } from "./vector-wall-proximity";
import type { GammaMagnet, GammaMagnetPull } from "./vector-gamma-magnet";
import type { WallIntegrity, WallIntegrityTier } from "./vector-wall-integrity";
import type { VectorWallEvent } from "./vector-wall-events";

// ---------------------------------------------------------------------------
// Signal — the unit of the live event feed
// ---------------------------------------------------------------------------

export type PulseSignalTone = "bull" | "bear" | "warn" | "info";

export type PulseSignalKind =
  | "regime-flip"
  | "proximity"
  | "magnet-shift"
  | "integrity"
  | "wall-structure";

export type PulseSignal = {
  key: string;
  kind: PulseSignalKind;
  tone: PulseSignalTone;
  line: string;
  at: number;
};

// ---------------------------------------------------------------------------
// Snapshot — the diffable state at one tick
// ---------------------------------------------------------------------------

export type PulseSnapshot = {
  at: number;
  regimePosture: VectorRegimePosture;
  proximityStrike: number | null;
  proximitySide: WallProximitySide | null;
  proximityNearness: "near" | "testing" | "at" | null;
  magnetPull: GammaMagnetPull | null;
  magnetStrike: number | null;
  callIntegrityTier: WallIntegrityTier | null;
  putIntegrityTier: WallIntegrityTier | null;
  wallEventCount: number;
};

export function buildPulseSnapshot(input: {
  at: number;
  regime: VectorRegime;
  proximity: WallProximity | null;
  magnet: GammaMagnet | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
  wallEventCount: number;
}): PulseSnapshot {
  return {
    at: input.at,
    regimePosture: input.regime.posture,
    proximityStrike: input.proximity?.strike ?? null,
    proximitySide: input.proximity?.side ?? null,
    proximityNearness: input.proximity?.nearness ?? null,
    magnetPull: input.magnet?.pull ?? null,
    magnetStrike: input.magnet?.strike ?? null,
    callIntegrityTier: input.wallIntegrity.call?.tier ?? null,
    putIntegrityTier: input.wallIntegrity.put?.tier ?? null,
    wallEventCount: input.wallEventCount,
  };
}

// ---------------------------------------------------------------------------
// Transition detector
// ---------------------------------------------------------------------------

const MAX_SIGNALS_PER_TICK = 6;

function fmtLevel(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function nearnessRank(n: "near" | "testing" | "at"): number {
  return n === "near" ? 1 : n === "testing" ? 2 : 3;
}

function tierRank(t: WallIntegrityTier): number {
  return t === "thin" ? 1 : t === "moderate" ? 2 : 3;
}

export function detectPulseSignals(
  prev: PulseSnapshot | null,
  next: PulseSnapshot
): PulseSignal[] {
  if (!prev) return [];
  const at = next.at;
  const signals: PulseSignal[] = [];

  // 1) Regime flip — the highest-priority signal.
  if (
    prev.regimePosture !== next.regimePosture &&
    next.regimePosture !== "unknown"
  ) {
    const tone: PulseSignalTone =
      next.regimePosture === "long"
        ? "bull"
        : next.regimePosture === "short"
          ? "bear"
          : "warn";

    const desc =
      next.regimePosture === "long"
        ? "LONG GAMMA — dealers dampen moves, fade extremes"
        : next.regimePosture === "short"
          ? "SHORT GAMMA — dealers amplify moves, trade momentum"
          : "AT GAMMA FLIP — regime undecided, sharpest moves here";

    signals.push({
      key: `regime:${prev.regimePosture}->${next.regimePosture}`,
      kind: "regime-flip",
      tone,
      at,
      line: `⚡ regime flipped → ${desc}`,
    });
  }

  // 2) Proximity — new level entered, nearness escalated, or level cleared.
  if (next.proximityNearness && next.proximityStrike != null) {
    const sideLabel =
      next.proximitySide === "flip"
        ? "gamma flip"
        : next.proximitySide === "call"
          ? "call wall"
          : "put wall";

    const levelChanged =
      !prev.proximityStrike ||
      prev.proximitySide !== next.proximitySide ||
      Math.abs((prev.proximityStrike ?? 0) - next.proximityStrike) > 1;

    if (levelChanged) {
      signals.push({
        key: `prox:enter:${next.proximitySide}:${Math.round(next.proximityStrike)}`,
        kind: "proximity",
        tone: next.proximityNearness === "at" ? "warn" : "info",
        at,
        line: `🎯 approaching ${sideLabel} ${fmtLevel(next.proximityStrike)} — ${next.proximityNearness}`,
      });
    } else if (
      prev.proximityNearness &&
      nearnessRank(next.proximityNearness) > nearnessRank(prev.proximityNearness)
    ) {
      const verb = next.proximityNearness === "at" ? "AT" : "TESTING";
      signals.push({
        key: `prox:${next.proximityNearness}:${next.proximitySide}:${Math.round(next.proximityStrike)}`,
        kind: "proximity",
        tone: next.proximityNearness === "at" ? "warn" : "info",
        at,
        line: `🔥 ${verb} ${sideLabel} ${fmtLevel(next.proximityStrike)} — ${next.proximitySide === "flip" ? "cross flips the regime" : "dealers defending this level"}`,
      });
    }
  }
  if (prev.proximityNearness && !next.proximityNearness) {
    signals.push({
      key: "prox:clear",
      kind: "proximity",
      tone: "info",
      at,
      line: "↔ spot moved to open space — no level in proximity",
    });
  }

  // 3) Magnet pull direction change.
  if (
    prev.magnetPull &&
    next.magnetPull &&
    prev.magnetPull !== next.magnetPull &&
    next.magnetStrike != null
  ) {
    signals.push({
      key: `magnet:${prev.magnetPull}->${next.magnetPull}`,
      kind: "magnet-shift",
      tone: next.magnetPull === "up" ? "bull" : next.magnetPull === "down" ? "bear" : "info",
      at,
      line: `🧲 gamma center of mass shifted ${next.magnetPull === "up" ? "above" : next.magnetPull === "down" ? "below" : "onto"} spot (${fmtLevel(next.magnetStrike)})`,
    });
  }

  // 4) Wall integrity tier changes.
  for (const side of ["call", "put"] as const) {
    const prevTier = side === "call" ? prev.callIntegrityTier : prev.putIntegrityTier;
    const nextTier = side === "call" ? next.callIntegrityTier : next.putIntegrityTier;
    if (prevTier && nextTier && prevTier !== nextTier) {
      const degraded = tierRank(nextTier) < tierRank(prevTier);
      signals.push({
        key: `integrity:${side}:${nextTier}`,
        kind: "integrity",
        tone: degraded ? "warn" : side === "call" ? "bull" : "bear",
        at,
        line: degraded
          ? `⚠️ ${side} wall confidence ${prevTier} → ${nextTier} — weakening, don't over-trust`
          : `✅ ${side} wall confidence ${prevTier} → ${nextTier} — strengthening`,
      });
    }
  }

  return signals.slice(0, MAX_SIGNALS_PER_TICK);
}

// ---------------------------------------------------------------------------
// Cooldown dedup — same discipline as SPX Live Voice filterFreshVoiceEvents
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_MS = 4 * 60 * 1000;

export function filterFreshPulseSignals(
  signals: PulseSignal[],
  seenAtByKey: Record<string, number>,
  nowMs: number,
  cooldownMs = DEFAULT_COOLDOWN_MS
): { fresh: PulseSignal[]; seen: Record<string, number> } {
  const seen: Record<string, number> = {};
  for (const [k, t] of Object.entries(seenAtByKey)) {
    if (nowMs - t < cooldownMs * 4) seen[k] = t;
  }
  const fresh: PulseSignal[] = [];
  for (const signal of signals) {
    const last = seen[signal.key];
    if (last != null && nowMs - last < cooldownMs) continue;
    seen[signal.key] = nowMs;
    fresh.push(signal);
  }
  return { fresh, seen };
}

// ---------------------------------------------------------------------------
// Wall event → PulseSignal conversion
// ---------------------------------------------------------------------------

export function wallEventToPulseSignal(ev: VectorWallEvent): PulseSignal {
  const tone: PulseSignalTone =
    ev.severity === "warn"
      ? "warn"
      : ev.kind.startsWith("call_wall") || ev.kind === "spot_broke_put"
        ? "bull"
        : ev.kind.startsWith("put_wall") || ev.kind === "spot_broke_call"
          ? "bear"
          : ev.kind === "spot_crossed_flip"
            ? "warn"
            : "info";

  return {
    key: `wall:${ev.kind}:${ev.time}`,
    kind: "wall-structure",
    tone,
    line: ev.message,
    at: ev.time * 1000,
  };
}

/** Max signals kept in the feed — older ones pruned to bound memory. */
export const PULSE_FEED_MAX = 50;
