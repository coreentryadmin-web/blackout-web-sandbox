/**
 * SPX Slayer — Playbook Shadow Matcher (shadow + live-gate input).
 *
 * Code-computable approximation of PB-01…PB-14 against `SpxDeskPayload` +
 * `PlayTechnicals`. MVP fallbacks per `docs/spx/PLAYBOOK-FULL-SPEC-v2.md` where
 * NEEDS-FIELD items are not yet on the desk.
 *
 * Default consumers are shadow-only. Primary selection uses explicit priority order
 * (§5 FULL-SPEC), not registry array order.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import {
  PLAYBOOK_REGISTRY,
  playbookDef,
  type PlaybookId,
  type PlaybookSessionWindow,
} from "@/features/spx/lib/playbook-registry";
import { isPlaybookEligible } from "@/features/spx/lib/playbook-regime-router";
import {
  pb14LongBreakReady,
  pb14ShortBreakReady,
  type OrBreakMemory,
} from "@/features/spx/lib/playbook-break-memory";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { playbookFlowMaterialityMin } from "@/features/spx/lib/spx-play-config";
import {
  scaledPlaybookMtfBufferPts,
  scaledPlaybookStructureProximityPts,
} from "@/features/spx/lib/playbook-volatility-scale";
import { pickPrimaryPlaybook } from "@/features/spx/lib/playbook-primary-rank";

export type PlaybookDirectionVerdict = "long" | "short" | null;

export type PlaybookMatchVerdict = {
  playbook_id: PlaybookId;
  session_window_open: boolean;
  regime_eligible: boolean;
  precondition_match: boolean;
  trigger_fired: boolean;
  direction: PlaybookDirectionVerdict;
  detail: string;
};

export type PlaybookShadowMatchResult = {
  verdicts: PlaybookMatchVerdict[];
  primary_playbook_id: PlaybookId | null;
};

function isWithinSessionWindow(window: PlaybookSessionWindow, etMins: number): boolean {
  const start = etClock(window.startEtHour, window.startEtMin);
  const end = etClock(window.endEtHour, window.endEtMin);
  return etMins >= start && etMins < end;
}

function flowDirection(desk: SpxDeskPayload): "bullish" | "bearish" | "neutral" | null {
  const net = desk.flow_0dte_net;
  if (net == null) return null;
  if (net > 0) return "bullish";
  if (net < 0) return "bearish";
  return "neutral";
}

function flowMaterialBearish(desk: SpxDeskPayload): boolean {
  const net = desk.flow_0dte_net;
  if (net == null) return false;
  return net <= -playbookFlowMaterialityMin();
}

function netPremAccelerating(
  ticks: { net: number }[],
  bullish: boolean
): boolean {
  if (ticks.length < 3) return false;
  const last3 = ticks.slice(-3).map((t) => t.net);
  if (bullish) return last3[2] > last3[1] && last3[1] > last3[0] && last3[2] > 0;
  return last3[2] < last3[1] && last3[1] < last3[0] && last3[2] < 0;
}

function netPremDecelerating(ticks: { net: number }[]): boolean {
  if (ticks.length < 3) return false;
  const a = Math.abs(ticks[ticks.length - 3].net);
  const b = Math.abs(ticks[ticks.length - 2].net);
  const c = Math.abs(ticks[ticks.length - 1].net);
  return c < b && b < a;
}

function matchPb01(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-01");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.vwap != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "VWAP or technicals unavailable — cannot evaluate PB-01",
    };
  }

  const flow = flowDirection(desk);
  const belowLongEnough = technicals.minutes_below_vwap >= 15;
  const aboveLongEnough = technicals.minutes_above_vwap >= 15;
  const emaCurlOk = technicals.ema9_curling_toward_vwap !== false;
  const m3Above = technicals.m3_consecutive_closes_above_vwap >= 2;
  const m3Below = technicals.m3_consecutive_closes_below_vwap >= 2;

  const longPrecondition = belowLongEnough && emaCurlOk;
  const shortPrecondition = aboveLongEnough && emaCurlOk;
  const longTrigger =
    regimeEligible &&
    windowOpen &&
    (m3Above || technicals.breakout.vwap_reclaim === true) &&
    flow !== "bearish";
  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    (m3Below || technicals.breakout.vwap_lost === true) &&
    flow !== "bullish";

  if (longTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: longPrecondition,
      trigger_fired: true,
      direction: "long",
      detail: `VWAP reclaim: below=${technicals.minutes_below_vwap}m m3_above=${technicals.m3_consecutive_closes_above_vwap} flow=${flow ?? "unknown"}`,
    };
  }
  if (shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: shortPrecondition,
      trigger_fired: true,
      direction: "short",
      detail: `VWAP lost: above=${technicals.minutes_above_vwap}m m3_below=${technicals.m3_consecutive_closes_below_vwap} flow=${flow ?? "unknown"}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: longPrecondition || shortPrecondition,
    trigger_fired: false,
    direction: null,
    detail: !regimeEligible
      ? `Regime ineligible for PB-01 (desk.regime=${desk.regime})`
      : `No VWAP reclaim/loss (flow=${flow ?? "unknown"})`,
  };
}

function matchPb02(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-02");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.vwap != null && desk.price > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "VWAP or technicals unavailable — cannot evaluate PB-02",
    };
  }

  const vwap = desk.vwap as number;
  const distanceFromVwap = vwap - desk.price;
  const nearBandFromBelow =
    desk.above_vwap === false &&
    distanceFromVwap >= 0 &&
    distanceFromVwap <= scaledPlaybookStructureProximityPts(desk);
  const rallyContext = technicals.minutes_above_vwap >= 2 || nearBandFromBelow;
  const flow = flowDirection(desk);
  const flowMaterialShort = flowMaterialBearish(desk);
  const rejectClose =
    technicals.breakout.vwap_lost === true || technicals.m3_consecutive_closes_below_vwap >= 1;
  const triggerFired =
    regimeEligible && windowOpen && rejectClose && flowMaterialShort && nearBandFromBelow;

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: rallyContext && nearBandFromBelow,
    trigger_fired: triggerFired,
    direction: triggerFired ? "short" : null,
    detail: !regimeEligible
      ? `Regime ineligible for PB-02 (desk.regime=${desk.regime})`
      : triggerFired
        ? `VWAP reject: price ${desk.price} lost vwap ${vwap}, flow ${flow} (material)`
        : `No VWAP rejection (near_band=${nearBandFromBelow}, flow=${flow ?? "unknown"}, material=${flowMaterialShort})`,
  };
}

function matchPb03(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-03");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && (technicals.or_defined || (desk.hod != null && desk.lod != null));

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "OR/HOD/LOD or technicals unavailable — cannot evaluate PB-03",
    };
  }

  const notPinning = desk.gamma_regime !== "mean_revert";
  const orReady = technicals.or_defined && technicals.or_high != null && technicals.or_low != null;
  const preconditionMatch = notPinning && (orReady || (desk.hod != null && desk.lod != null));
  const flow = flowDirection(desk);
  const feedDegraded =
    desk.feed_stalled === true ||
    desk.halt_channel_stale === true ||
    (desk.active_halts?.length ?? 0) > 0;
  const buf = scaledPlaybookMtfBufferPts(desk, technicals);

  let brokeHigh = false;
  let brokeLow = false;
  if (orReady) {
    brokeHigh = desk.price > (technicals.or_high as number) + buf;
    brokeLow = desk.price < (technicals.or_low as number) - buf;
  } else {
    brokeHigh = technicals.breakout.hod_break === true;
    brokeLow = technicals.breakout.lod_break === true;
  }

  const longTrigger =
    regimeEligible && windowOpen && !feedDegraded && brokeHigh && desk.above_gamma_flip === true && flow !== "bearish";
  const shortTrigger =
    regimeEligible && windowOpen && !feedDegraded && brokeLow && desk.above_gamma_flip === false && flow !== "bullish";

  const orLabel = orReady
    ? `OR ${technicals.or_low!.toFixed(0)}–${technicals.or_high!.toFixed(0)}`
    : "OR proxy HOD/LOD";

  if (longTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: preconditionMatch,
      trigger_fired: true,
      direction: "long",
      detail: `ORB long: price ${desk.price} cleared ${orLabel}`,
    };
  }
  if (shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: preconditionMatch,
      trigger_fired: true,
      direction: "short",
      detail: `ORB short: price ${desk.price} broke ${orLabel}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: null,
    detail: !regimeEligible
      ? `Regime ineligible for PB-03`
      : feedDegraded
        ? "Halt/feed degraded — ORB suppressed"
        : `No OR break (${orLabel})`,
  };
}

function matchPb04(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-04");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const walls = desk.gex_walls ?? [];
  const dataAvailable = technicals.available && desk.price > 0 && walls.length > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "GEX walls or technicals unavailable — cannot evaluate PB-04",
    };
  }

  const pinning = desk.gamma_regime === "mean_revert";
  const prox = scaledPlaybookStructureProximityPts(desk);
  const resistanceAbove = walls
    .filter((w) => w.kind === "resistance" && w.strike >= desk.price)
    .sort((a, b) => a.strike - b.strike)[0];
  const supportBelow = walls
    .filter((w) => w.kind === "support" && w.strike <= desk.price)
    .sort((a, b) => b.strike - a.strike)[0];
  const betweenWalls = resistanceAbove != null && supportBelow != null;
  const preconditionMatch = pinning && betweenWalls;
  const flow = flowDirection(desk);
  const breakingOut = technicals.breakout.hod_break === true || technicals.breakout.lod_break === true;
  const nearResistance = resistanceAbove != null && resistanceAbove.strike - desk.price <= prox;
  const nearSupport = supportBelow != null && desk.price - supportBelow.strike <= prox;

  const shortTrigger =
    regimeEligible && windowOpen && preconditionMatch && !breakingOut && nearResistance && flow !== "bullish";
  const longTrigger =
    regimeEligible && windowOpen && preconditionMatch && !breakingOut && !nearResistance && nearSupport && flow !== "bearish";

  if (shortTrigger || longTrigger) {
    const wall = shortTrigger ? resistanceAbove! : supportBelow!;
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: shortTrigger ? "short" : "long",
      detail: `Pin fade ${shortTrigger ? "off resistance" : "off support"} ${wall.strike}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: null,
    detail: !pinning ? `No gamma pin (${desk.gamma_regime})` : breakingOut ? "Breakout — pin fade invalidated" : "Pinned — awaiting wall touch",
  };
}

/** PB-05 MVP: simple wall proximity pre (no VEX streak NEEDS-FIELD). */
function matchPb05(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-05");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const walls = desk.gex_walls ?? [];
  const dataAvailable = technicals.available && desk.price > 0 && walls.length > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Walls or technicals unavailable — cannot evaluate PB-05",
    };
  }

  const prox = scaledPlaybookStructureProximityPts(desk);
  const buf = scaledPlaybookMtfBufferPts(desk, technicals);
  const flow = flowDirection(desk);
  const ticks = desk.net_prem_ticks ?? [];

  const callWall = walls
    .filter((w) => w.kind === "resistance")
    .sort((a, b) => Math.abs(a.strike - desk.price) - Math.abs(b.strike - desk.price))[0];
  const putWall = walls
    .filter((w) => w.kind === "support")
    .sort((a, b) => Math.abs(a.strike - desk.price) - Math.abs(b.strike - desk.price))[0];

  const nearCall = callWall != null && Math.abs(desk.price - callWall.strike) <= prox;
  const nearPut = putWall != null && Math.abs(desk.price - putWall.strike) <= prox;
  const longPre = nearCall && desk.price <= (callWall?.strike ?? 0) + prox;
  const shortPre = nearPut && desk.price >= (putWall?.strike ?? 0) - prox;

  const longTrigger =
    regimeEligible &&
    windowOpen &&
    callWall != null &&
    longPre &&
    desk.price > callWall.strike + buf &&
    flow === "bullish" &&
    netPremAccelerating(ticks, true);
  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    putWall != null &&
    shortPre &&
    desk.price < putWall.strike - buf &&
    flow === "bearish" &&
    netPremAccelerating(ticks, false);

  if (longTrigger || shortTrigger) {
    const wall = longTrigger ? callWall! : putWall!;
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Wall break ${longTrigger ? "up" : "down"} through ${wall.strike} (MVP proximity pre)`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: longPre || shortPre,
    trigger_fired: false,
    direction: null,
    detail: longPre || shortPre ? "Compressed at wall — awaiting m3 close through" : "No wall compression",
  };
}

function matchPb06(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-06");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const flip = desk.gamma_flip;
  const dataAvailable = technicals.available && desk.price > 0 && flip != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "γ flip or technicals unavailable — cannot evaluate PB-06",
    };
  }

  const prox = scaledPlaybookStructureProximityPts(desk);
  const buf = scaledPlaybookMtfBufferPts(desk, technicals);
  const nearFlip = Math.abs(desk.price - flip) <= prox;
  const ema9 = technicals.m1_ema9;

  const longTrigger =
    regimeEligible &&
    windowOpen &&
    nearFlip &&
    desk.price > flip + buf &&
    ema9 != null &&
    ema9 > flip &&
    (technicals.m5_trend === "up" || technicals.m5_trend === "flat");
  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    nearFlip &&
    desk.price < flip - buf &&
    ema9 != null &&
    ema9 < flip &&
    (technicals.m5_trend === "down" || technicals.m5_trend === "flat");

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: nearFlip,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Flip ride ${longTrigger ? "above" : "below"} γ ${flip} (ema9=${ema9?.toFixed(1)})`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: nearFlip,
    trigger_fired: false,
    direction: null,
    detail: nearFlip ? `Oscillating at γ flip ${flip}` : `Away from γ flip (${flip})`,
  };
}

function matchPb07(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-07");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const pain = desk.max_pain;
  const dataAvailable = technicals.available && desk.price > 0 && pain != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Max pain or technicals unavailable — cannot evaluate PB-07",
    };
  }

  const distPct = Math.abs(desk.price - pain) / desk.price;
  const pinning = desk.gamma_regime === "mean_revert";
  const preconditionMatch = distPct > 0.003 && pinning;
  const flow = flowDirection(desk);
  const towardPainLong = desk.price < pain && flow === "bullish";
  const towardPainShort = desk.price > pain && flow === "bearish";
  const stall = technicals.m5_trend === "flat";

  const longTrigger = regimeEligible && windowOpen && preconditionMatch && stall && towardPainLong;
  const shortTrigger = regimeEligible && windowOpen && preconditionMatch && stall && towardPainShort;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Gravitation toward max pain ${pain} (dist ${(distPct * 100).toFixed(2)}%)`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: desk.price > pain ? "short" : desk.price < pain ? "long" : null,
    detail: !preconditionMatch
      ? `Too close to max pain or not pinned (dist=${(distPct * 100).toFixed(2)}%, γ=${desk.gamma_regime})`
      : "Stall toward pain not confirmed",
  };
}

function matchPb08(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-08");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.price > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Technicals unavailable — cannot evaluate PB-08",
    };
  }

  const flow = flowDirection(desk);
  const bullDominant = flow === "bullish" && technicals.minutes_above_vwap >= 10;
  const bearDominant = flow === "bearish" && technicals.minutes_below_vwap >= 10;
  const longTrigger = regimeEligible && windowOpen && bullDominant && technicals.breakout.hod_break === true;
  const shortTrigger = regimeEligible && windowOpen && bearDominant && technicals.breakout.lod_break === true;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Power hour ${longTrigger ? "HOD" : "LOD"} break, dominant ${flow} flow`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: bullDominant || bearDominant,
    trigger_fired: false,
    direction: null,
    detail: !windowOpen ? "Outside power hour" : `No dominant flow/break (flow=${flow ?? "unknown"})`,
  };
}

function matchPb09(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean,
  now: number
): PlaybookMatchVerdict {
  const def = playbookDef("PB-09");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const flows = desk.spx_flows ?? [];
  const dataAvailable = technicals.available && desk.price > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Technicals unavailable — cannot evaluate PB-09",
    };
  }

  const nowMs = now;
  let bestSurge: (typeof flows)[0] | null = null;
  for (const f of flows) {
    const ticker = (f.ticker ?? "").toUpperCase();
    if (ticker !== "SPX" && ticker !== "SPXW") continue;
    if (!f.has_sweep || f.premium < 1_000_000) continue;
    const alertedAt = f.alerted_at ? new Date(f.alerted_at).getTime() : 0;
    if (!alertedAt || nowMs - alertedAt > 120_000) continue;
    if (!bestSurge || f.premium > bestSurge.premium) bestSurge = f;
  }

  const preconditionMatch = bestSurge != null;
  const flow = flowDirection(desk);
  const optType = (bestSurge?.option_type ?? "").toUpperCase();
  const surgeBull = optType.startsWith("C");
  const surgeBear = optType.startsWith("P");
  const strikeProx = bestSurge != null && Math.abs(desk.price - bestSurge.strike) <= 15;

  const longTrigger =
    regimeEligible && windowOpen && bestSurge != null && surgeBull && flow === "bullish" && strikeProx;
  const shortTrigger =
    regimeEligible && windowOpen && bestSurge != null && surgeBear && flow === "bearish" && strikeProx;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `HELIX surge $${(bestSurge!.premium / 1e6).toFixed(1)}M @ ${bestSurge!.strike} strike prox=${Math.abs(desk.price - bestSurge!.strike).toFixed(0)}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: surgeBull ? "long" : surgeBear ? "short" : null,
    detail: bestSurge
      ? `Surge armed — awaiting desk flow align + strike prox (flow=${flow ?? "unknown"})`
      : "No HELIX-tier sweep in last 120s",
  };
}

function matchPb10(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-10");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const ema9 = technicals.m1_ema9;
  const ema20 = desk.ema20;
  const sma50 = desk.sma50;
  const dataAvailable = technicals.available && desk.price > 0 && ema9 != null && ema20 != null && sma50 != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "EMA stack or technicals unavailable — cannot evaluate PB-10",
    };
  }

  const flow = flowDirection(desk);
  const bullStack = ema9 > ema20 && ema20 > sma50;
  const bearStack = ema9 < ema20 && ema20 < sma50;
  const bullPullback = bullStack && Math.abs(desk.price - ema9) <= 3 && technicals.minutes_above_vwap >= 10;
  const bearPullback = bearStack && Math.abs(desk.price - ema9) <= 3 && technicals.minutes_below_vwap >= 10;
  const m3 = technicals.m3_close ?? desk.price;

  const longTrigger =
    regimeEligible && windowOpen && bullPullback && m3 > ema9 && flow === "bullish";
  const shortTrigger =
    regimeEligible && windowOpen && bearPullback && m3 < ema9 && flow === "bearish";

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `EMA stack pullback bounce (${longTrigger ? "bull" : "bear"} stack)`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: bullPullback || bearPullback,
    trigger_fired: false,
    direction: bullStack ? "long" : bearStack ? "short" : null,
    detail: bullPullback || bearPullback ? "Pullback to EMA9 — awaiting bounce" : "No aligned EMA stack pullback",
  };
}

function matchPb11(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-11");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const rangeHigh = technicals.rolling_30m_high ?? desk.hod;
  const rangeLow = technicals.rolling_30m_low ?? desk.lod;
  const usingRolling = technicals.rolling_30m_high != null && technicals.rolling_30m_low != null;
  const dataAvailable = technicals.available && desk.price > 0 && rangeHigh != null && rangeLow != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Range high/low unavailable — cannot evaluate PB-11",
    };
  }

  const rangePct = (rangeHigh - rangeLow) / desk.price;
  const noBreakout = !technicals.breakout.hod_break && !technicals.breakout.lod_break;
  const preconditionMatch = rangePct <= 0.0035 && noBreakout;
  const edgeProx = 3;
  const nearHigh = rangeHigh - desk.price <= edgeProx;
  const nearLow = desk.price - rangeLow <= edgeProx;
  const m3 = technicals.m3_close ?? desk.price;
  const mid = (rangeHigh + rangeLow) / 2;
  const rangeTag = usingRolling ? "30m" : "session";

  const shortTrigger =
    regimeEligible && windowOpen && preconditionMatch && nearHigh && m3 < rangeHigh && m3 < mid;
  const longTrigger =
    regimeEligible && windowOpen && preconditionMatch && nearLow && m3 > rangeLow && m3 > mid;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Range fade (${rangeTag}) off ${longTrigger ? "low" : "high"} — ${(rangePct * 100).toFixed(2)}%`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: null,
    detail: preconditionMatch
      ? `Tight ${rangeTag} range — awaiting edge fade`
      : `Range too wide (${rangeTag} ${(rangePct * 100).toFixed(2)}%) or breakout active`,
  };
}

/** PB-12 MVP: session `spx_change_pct` proxy for 15m rolling change. */
function matchPb12(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-12");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const walls = desk.gex_walls ?? [];
  const dataAvailable = technicals.available && desk.price > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Technicals unavailable — cannot evaluate PB-12",
    };
  }

  const prox = scaledPlaybookStructureProximityPts(desk);
  const ext = Math.abs(desk.spx_change_pct) >= 0.5;
  const rsi = technicals.m5_rsi;
  const overbought = rsi != null && rsi >= 72;
  const oversold = rsi != null && rsi <= 28;
  const nearWall = walls.some((w) => Math.abs(w.strike - desk.price) <= prox);
  const preconditionMatch = ext && (overbought || oversold) && nearWall;
  const ticks = desk.net_prem_ticks ?? [];
  const exhausted = netPremDecelerating(ticks);

  const shortTrigger =
    regimeEligible && windowOpen && preconditionMatch && overbought && exhausted && technicals.m5_trend !== "up";
  const longTrigger =
    regimeEligible && windowOpen && preconditionMatch && oversold && exhausted && technicals.m5_trend !== "down";

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Lotto reversal RSI=${rsi?.toFixed(0)} chg=${desk.spx_change_pct}% (MVP session chg proxy)`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: overbought ? "short" : oversold ? "long" : null,
    detail: preconditionMatch ? "Extension + RSI stretch — awaiting exhaustion" : "No lotto extension setup",
  };
}

function matchPb13(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = playbookDef("PB-13");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const gap = desk.gap_pct;
  const prior = desk.prior_close;
  const dataAvailable = technicals.available && desk.price > 0 && gap != null && prior != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "Gap data unavailable — cannot evaluate PB-13",
    };
  }

  const gapUp = gap >= 0.3;
  const gapDown = gap <= -0.3;
  const preconditionMatch = gapUp || gapDown;
  const m3 = technicals.m3_close ?? desk.price;

  const fadeShort =
    gapUp &&
    !technicals.breakout.hod_break &&
    m3 < desk.price &&
    m3 < prior + Math.abs(gap) * prior * 0.01 * 0.5;
  const fadeLong =
    gapDown &&
    !technicals.breakout.lod_break &&
    m3 > desk.price &&
    m3 > prior - Math.abs(gap) * prior * 0.01 * 0.5;

  const shortTrigger = regimeEligible && windowOpen && fadeShort;
  const longTrigger = regimeEligible && windowOpen && fadeLong;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Gap fade ${gap.toFixed(2)}% — fill toward prior ${prior}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: gapUp ? "short" : gapDown ? "long" : null,
    detail: preconditionMatch ? `Gap ${gap.toFixed(2)}% — awaiting failed extension` : "No meaningful open gap",
  };
}

/** PB-14: failed OR break then re-entry — requires session break memory. */
function matchPb14(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean,
  breakMemory: OrBreakMemory | null | undefined
): PlaybookMatchVerdict {
  const def = playbookDef("PB-14");
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const orReady = technicals.or_defined && technicals.or_high != null && technicals.or_low != null;
  const dataAvailable = technicals.available && desk.price > 0 && orReady;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      regime_eligible: regimeEligible,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "OR unavailable — cannot evaluate PB-14",
    };
  }

  const orHigh = technicals.or_high as number;
  const orLow = technicals.or_low as number;
  const orMid = (orHigh + orLow) / 2;
  const insideOr = desk.price >= orLow && desk.price <= orHigh;
  const flow = flowDirection(desk);
  const m3 = technicals.m3_close ?? desk.price;

  const longReady = breakMemory ? pb14LongBreakReady(breakMemory) : false;
  const shortReady = breakMemory ? pb14ShortBreakReady(breakMemory) : false;

  const longTrigger =
    regimeEligible &&
    windowOpen &&
    insideOr &&
    longReady &&
    m3 > orMid &&
    flow === "bullish";
  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    insideOr &&
    shortReady &&
    m3 < orMid &&
    flow === "bearish";

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: insideOr && (longReady || shortReady),
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Failed-break reversal ${longTrigger ? "long" : "short"} vs OR mid ${orMid.toFixed(0)} (break memory)`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    regime_eligible: regimeEligible,
    precondition_match: insideOr,
    trigger_fired: false,
    direction: null,
    detail: insideOr
      ? longReady || shortReady
        ? "Inside OR — awaiting mid cross + flow flip"
        : "Inside OR — awaiting prior OR break + re-entry"
      : "Outside OR — no failed-break re-entry",
  };
}

export type PlaybookShadowMatchOpts = {
  or_break_memory?: OrBreakMemory | null;
};

export function matchPlaybooksShadow(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  now: number = Date.now(),
  opts?: PlaybookShadowMatchOpts
): PlaybookShadowMatchResult {
  const etMins = etMinutes(new Date(now));
  const breakMemory = opts?.or_break_memory ?? null;
  const verdicts = PLAYBOOK_REGISTRY.map((pb) => {
    const eligible = isPlaybookEligible(pb.id, desk, now);
    switch (pb.id) {
      case "PB-01":
        return matchPb01(desk, technicals, etMins, eligible);
      case "PB-02":
        return matchPb02(desk, technicals, etMins, eligible);
      case "PB-03":
        return matchPb03(desk, technicals, etMins, eligible);
      case "PB-04":
        return matchPb04(desk, technicals, etMins, eligible);
      case "PB-05":
        return matchPb05(desk, technicals, etMins, eligible);
      case "PB-06":
        return matchPb06(desk, technicals, etMins, eligible);
      case "PB-07":
        return matchPb07(desk, technicals, etMins, eligible);
      case "PB-08":
        return matchPb08(desk, technicals, etMins, eligible);
      case "PB-09":
        return matchPb09(desk, technicals, etMins, eligible, now);
      case "PB-10":
        return matchPb10(desk, technicals, etMins, eligible);
      case "PB-11":
        return matchPb11(desk, technicals, etMins, eligible);
      case "PB-12":
        return matchPb12(desk, technicals, etMins, eligible);
      case "PB-13":
        return matchPb13(desk, technicals, etMins, eligible);
      case "PB-14":
        return matchPb14(desk, technicals, etMins, eligible, breakMemory);
      default:
        throw new Error(`unhandled playbook ${pb.id}`);
    }
  });

  return {
    verdicts,
    primary_playbook_id: pickPrimaryPlaybook(verdicts),
  };
}
