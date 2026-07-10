/**
 * SPX Slayer — Playbook Registry (SHADOW MODE ONLY).
 *
 * Full catalog PB-01…PB-14 from `docs/spx/PLAYBOOK-FULL-SPEC-v2.md` / design doc
 * Section 6 (`scripts/generate-playbook-design-docx.py`). Verbatim precondition/trigger/
 * invalidation strings for PB-01–12; PB-13/14 from FULL-SPEC v2 additions.
 *
 * SHADOW-MODE / INERTNESS: never imported by live scoring/gating (`spx-signals.ts`,
 * `spx-play-gates.ts`, `spx-play-engine.ts`). Primary tie-break uses explicit priority
 * in `playbook-shadow-matcher.ts` (not registry array order).
 */

/** Stable per-playbook identity, used as `factor_name`/`playbook_id` in telemetry. */
export type PlaybookId =
  | "PB-01"
  | "PB-02"
  | "PB-03"
  | "PB-04"
  | "PB-05"
  | "PB-06"
  | "PB-07"
  | "PB-08"
  | "PB-09"
  | "PB-10"
  | "PB-11"
  | "PB-12"
  | "PB-13"
  | "PB-14";

export type PlaybookDirection = "long" | "short" | "either";

/** Typical session window from the design doc, in ET hour/minute — half-open [start, end). */
export type PlaybookSessionWindow = {
  startEtHour: number;
  startEtMin: number;
  endEtHour: number;
  endEtMin: number;
};

export type PlaybookDefinition = {
  id: PlaybookId;
  name: string;
  direction: PlaybookDirection;
  regimeTags: string;
  preconditions: string;
  trigger: string;
  invalidation: string;
  sessionWindow: PlaybookSessionWindow;
};

export const PLAYBOOK_REGISTRY: readonly PlaybookDefinition[] = [
  {
    id: "PB-01",
    name: "VWAP Reclaim",
    direction: "either",
    regimeTags: "Trend / recovery after flush",
    preconditions:
      "Price below VWAP ≥15m, then reclaims with volume; EMA9 curling toward VWAP.",
    trigger: "Close above VWAP + hold 2 consecutive 3m bars; flow skew aligns.",
    invalidation: "Close back below VWAP on volume; regime flips to chop.",
    sessionWindow: { startEtHour: 9, startEtMin: 45, endEtHour: 14, endEtMin: 0 },
  },
  {
    id: "PB-02",
    name: "VWAP Reject",
    direction: "short",
    regimeTags: "Weak trend / distribution",
    preconditions: "Rally into VWAP from below; repeated rejections at VWAP band.",
    trigger: "3m close rejection wick + negative net flow spike.",
    invalidation: "Acceptance above VWAP (2 closes).",
    sessionWindow: { startEtHour: 10, startEtMin: 0, endEtHour: 15, endEtMin: 0 },
  },
  {
    id: "PB-03",
    name: "Opening Range Breakout",
    direction: "either",
    regimeTags: "Opening drive",
    preconditions: "First 15–30m range defined; GEX not pinning inside range.",
    trigger: "Break of OR high/low with flow confirmation; spot clears flip level.",
    invalidation: "Re-entry inside OR; halt feed degraded (optional strict mode).",
    sessionWindow: { startEtHour: 9, startEtMin: 35, endEtHour: 10, endEtMin: 30 },
  },
  {
    id: "PB-04",
    name: "Gamma Pin Fade",
    direction: "either",
    regimeTags: "High pin / low vol midday",
    preconditions: "Spot between major walls; charm decay elevated; low ATR.",
    trigger: "Touch of wall + rejection; confluence on mean-reversion factors.",
    invalidation: "Sustained breakout through wall with flow.",
    sessionWindow: { startEtHour: 11, startEtMin: 30, endEtHour: 15, endEtMin: 0 },
  },
  {
    id: "PB-05",
    name: "Wall Break Continuation",
    direction: "either",
    regimeTags: "Trend / vol expansion",
    preconditions: "Price compressed under call or put wall; rising VEX magnitude.",
    trigger: "Close through wall + rising premium flow same direction.",
    invalidation: "Immediate reclaim inside wall within 5m.",
    sessionWindow: { startEtHour: 10, startEtMin: 0, endEtHour: 15, endEtMin: 30 },
  },
  {
    id: "PB-06",
    name: "Flip Level Ride",
    direction: "either",
    regimeTags: "Trend",
    preconditions: "Spot oscillating at gamma flip; regime trending.",
    trigger: "Decisive break of flip with EMA9/21 stack aligned.",
    invalidation: "Recross flip and hold 3m.",
    sessionWindow: { startEtHour: 9, startEtMin: 50, endEtHour: 16, endEtMin: 0 },
  },
  {
    id: "PB-07",
    name: "Max Pain Gravitation",
    direction: "either",
    regimeTags: "Expiry / pin",
    preconditions: "Spot >0.3% from max pain; time >14:00; charm elevated.",
    trigger: "Momentum stall toward pain; decreasing realized vol.",
    invalidation: "Strong flow trend away from pain.",
    sessionWindow: { startEtHour: 14, startEtMin: 0, endEtHour: 15, endEtMin: 45 },
  },
  {
    id: "PB-08",
    name: "Power Hour Momentum",
    direction: "either",
    regimeTags: "Power hour",
    preconditions: "15:00–16:00; net flow dominant one side 10m+.",
    trigger: "Break of 30m micro-range with accelerating prints.",
    invalidation: "Flow flip + VWAP cross against.",
    sessionWindow: { startEtHour: 15, startEtMin: 0, endEtHour: 15, endEtMin: 55 },
  },
  {
    id: "PB-09",
    name: "HELIX Flow Surge",
    direction: "either",
    regimeTags: "Any with premium spike",
    preconditions: "HELIX alert tier ≥ threshold; ticker SPX/SPXW.",
    trigger: "Desk direction aligns within 2 play polls; spot near strike cluster.",
    invalidation: "No follow-through next poll; opposite surge.",
    sessionWindow: { startEtHour: 9, startEtMin: 30, endEtHour: 16, endEtMin: 0 },
  },
  {
    id: "PB-10",
    name: "EMA Stack Pullback",
    direction: "either",
    regimeTags: "Trend",
    preconditions: "EMA9 > EMA21 > SMA50 (bull) or inverse; pullback to EMA9/21.",
    trigger: "Bounce candle + positive flow on 3m.",
    invalidation: "Close through EMA21 against trend.",
    sessionWindow: { startEtHour: 10, startEtMin: 0, endEtHour: 15, endEtMin: 0 },
  },
  {
    id: "PB-11",
    name: "Range Chop Scalp",
    direction: "either",
    regimeTags: "Chop / low trend score",
    preconditions: "Regime chop; defined 30m range; no breakout.",
    trigger: "Fade at range edge with rejection wick.",
    invalidation: "Range break with volume.",
    sessionWindow: { startEtHour: 11, startEtMin: 0, endEtHour: 14, endEtMin: 0 },
  },
  {
    id: "PB-12",
    name: "Lotto Reversal",
    direction: "either",
    regimeTags: "Extreme extension",
    preconditions: "Rapid extension >0.5% in 15m; RSI stretch; near wall.",
    trigger: "Reversal candle + flow exhaustion signal.",
    invalidation: "Continuation with new flow high.",
    sessionWindow: { startEtHour: 9, startEtMin: 30, endEtHour: 16, endEtMin: 0 },
  },
  {
    id: "PB-13",
    name: "Gap Fade",
    direction: "either",
    regimeTags: "Opening gap",
    preconditions: "Open gap ≥0.3% from prior close.",
    trigger: "First 15m fails to extend gap; m3 close back toward prior close.",
    invalidation: "New session extreme beyond the open drive.",
    sessionWindow: { startEtHour: 9, startEtMin: 35, endEtHour: 10, endEtMin: 30 },
  },
  {
    id: "PB-14",
    name: "Failed Breakout Reversal",
    direction: "either",
    regimeTags: "Opening drive / reversal",
    preconditions: "OR break occurred; price re-enters opening range.",
    trigger: "Re-entry inside OR + cross OR mid with flow flip to reversal side.",
    invalidation: "Price re-exits OR on the original break side.",
    sessionWindow: { startEtHour: 9, startEtMin: 50, endEtHour: 11, endEtMin: 30 },
  },
];

const REGISTRY_BY_ID = Object.fromEntries(PLAYBOOK_REGISTRY.map((p) => [p.id, p])) as Record<
  PlaybookId,
  PlaybookDefinition
>;

export function playbookDef(id: PlaybookId): PlaybookDefinition {
  return REGISTRY_BY_ID[id];
}
