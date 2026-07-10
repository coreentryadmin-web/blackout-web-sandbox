/**
 * SPX Slayer — Playbook Shadow Matcher (Phase 1 shadow + Phase 3 live-gate input).
 *
 * Pure, code-computable approximation of PB-01/PB-02/PB-03 against `SpxDeskPayload`
 * + `PlayTechnicals` (including bar-derived OR / VWAP streaks / EMA9 from
 * `spx-play-technicals.ts`). Caller passes `now` explicitly — fully unit-testable.
 *
 * Default consumers are shadow-only (`logPlaybookShadowMatch`, `buildPlaybookShadowPanel`).
 * When `PLAYBOOK_LIVE_GATE=1`, `evaluatePlayGates` may require `primary_playbook_id`
 * for BUY — see `playbookLiveGateEnabled()` in `spx-play-config.ts`.
 *
 * Regime eligibility is applied via `playbook-regime-router.ts` before trigger
 * selection: ineligible playbooks still return a verdict (for UI/telemetry) but
 * cannot become `primary_playbook_id` or fire a live-gate trigger.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { PLAYBOOK_REGISTRY, type PlaybookId, type PlaybookSessionWindow } from "@/features/spx/lib/playbook-registry";
import { isPlaybookEligible } from "@/features/spx/lib/playbook-regime-router";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { playMtfBufferPts, playStructureProximityPts } from "@/features/spx/lib/spx-play-config";

export type PlaybookDirectionVerdict = "long" | "short" | null;

export type PlaybookMatchVerdict = {
  playbook_id: PlaybookId;
  session_window_open: boolean;
  /** False when regime router excludes this playbook for the current desk tick. */
  regime_eligible: boolean;
  precondition_match: boolean;
  trigger_fired: boolean;
  direction: PlaybookDirectionVerdict;
  detail: string;
};

export type PlaybookShadowMatchResult = {
  verdicts: PlaybookMatchVerdict[];
  /** First registry-order eligible playbook whose `trigger_fired` is true, or null. */
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

/**
 * PB-01 VWAP Reclaim — uses bar streaks (≥15m below / ≥2× 3m closes) + EMA9 curl
 * when available; falls back to `breakout.vwap_reclaim` / `vwap_lost` for the
 * single-tick reclaim/loss edge.
 */
function matchPb01(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[0];
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
  const belowLongEnough = technicals.minutes_below_vwap >= 15 || desk.above_vwap === false;
  const aboveLongEnough = technicals.minutes_above_vwap >= 15 || desk.above_vwap === true;
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
      detail: `VWAP reclaim: below=${technicals.minutes_below_vwap}m m3_above=${technicals.m3_consecutive_closes_above_vwap} ema9=${technicals.m1_ema9?.toFixed(1) ?? "n/a"} curl=${technicals.ema9_curling_toward_vwap} flow=${flow ?? "unknown"}`,
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
      detail: `VWAP lost: above=${technicals.minutes_above_vwap}m m3_below=${technicals.m3_consecutive_closes_below_vwap} ema9=${technicals.m1_ema9?.toFixed(1) ?? "n/a"} curl=${technicals.ema9_curling_toward_vwap} flow=${flow ?? "unknown"}`,
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
      : `No VWAP reclaim/loss (below=${technicals.minutes_below_vwap}m above=${technicals.minutes_above_vwap}m m3±=${technicals.m3_consecutive_closes_above_vwap}/${technicals.m3_consecutive_closes_below_vwap} flow=${flow ?? "unknown"})`,
  };
}

/**
 * PB-02 VWAP Reject — proximity + streak context + bearish flow + vwap_lost / m3 below.
 */
function matchPb02(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[1];
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
    distanceFromVwap <= playStructureProximityPts();
  const rallyContext = technicals.minutes_above_vwap >= 2 || nearBandFromBelow;
  const flow = flowDirection(desk);
  const rejectClose =
    technicals.breakout.vwap_lost === true || technicals.m3_consecutive_closes_below_vwap >= 1;
  const triggerFired =
    regimeEligible && windowOpen && rejectClose && flow === "bearish" && nearBandFromBelow;

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
        ? `VWAP reject: price ${desk.price} lost vwap ${vwap}, flow ${flow}, m3_below=${technicals.m3_consecutive_closes_below_vwap}`
        : `No VWAP rejection (near_band=${nearBandFromBelow}, above_vwap=${desk.above_vwap}, flow=${flow ?? "unknown"})`,
  };
}

/**
 * PB-03 Opening Range Breakout — prefers true OR from minute bars (`or_high`/`or_low`);
 * falls back to HOD/LOD break flags only when OR is not yet defined (early window).
 */
function matchPb03(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[2];
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
  const buf = playMtfBufferPts();

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
    regimeEligible &&
    windowOpen &&
    !feedDegraded &&
    brokeHigh &&
    desk.above_gamma_flip === true &&
    flow !== "bearish";
  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    !feedDegraded &&
    brokeLow &&
    desk.above_gamma_flip === false &&
    flow !== "bullish";

  const orLabel = orReady
    ? `OR ${technicals.or_low!.toFixed(0)}–${technicals.or_high!.toFixed(0)} (${technicals.or_minutes}m)`
    : `OR proxy HOD/LOD (or_minutes=${technicals.or_minutes}, defined=${technicals.or_defined})`;

  if (longTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: preconditionMatch,
      trigger_fired: true,
      direction: "long",
      detail: `ORB long: price ${desk.price} cleared ${orLabel}, flow ${flow ?? "unknown"}`,
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
      detail: `ORB short: price ${desk.price} broke ${orLabel}, flow ${flow ?? "unknown"}`,
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
      ? `Regime ineligible for PB-03 (desk.regime=${desk.regime})`
      : feedDegraded
        ? "Halt/feed degraded — ORB trigger suppressed per PB-03 invalidation clause"
        : `No OR break (${orLabel}, gamma_regime=${desk.gamma_regime}, above_gamma_flip=${desk.above_gamma_flip})`,
  };
}

/**
 * PB-04 Gamma Pin Fade — EVIDENCE-BACKED (docs/spx/PLAYBOOK-EVIDENCE-BASE.md):
 * 18/19 logged prod plays entered while gamma_regime was `mean_revert` (dealer pin)
 * and net-lost fighting it with breakout-style longs. This playbook trades WITH the
 * pin: fade a wall touch back toward the interior when dealers dampen moves.
 */
function matchPb04(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[3];
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
  const prox = playStructureProximityPts();
  const resistanceAbove = walls
    .filter((w) => w.kind === "resistance" && w.strike >= desk.price)
    .sort((a, b) => a.strike - b.strike)[0];
  const supportBelow = walls
    .filter((w) => w.kind === "support" && w.strike <= desk.price)
    .sort((a, b) => b.strike - a.strike)[0];
  const betweenWalls = resistanceAbove != null && supportBelow != null;
  const preconditionMatch = pinning && betweenWalls;

  const flow = flowDirection(desk);
  // "Sustained breakout through wall" invalidation — suppress on live HOD/LOD break.
  const breakingOut = technicals.breakout.hod_break === true || technicals.breakout.lod_break === true;

  const nearResistance =
    resistanceAbove != null && resistanceAbove.strike - desk.price <= prox;
  const nearSupport = supportBelow != null && desk.price - supportBelow.strike <= prox;

  const shortTrigger =
    regimeEligible &&
    windowOpen &&
    preconditionMatch &&
    !breakingOut &&
    nearResistance &&
    flow !== "bullish";
  const longTrigger =
    regimeEligible &&
    windowOpen &&
    preconditionMatch &&
    !breakingOut &&
    !nearResistance &&
    nearSupport &&
    flow !== "bearish";

  if (shortTrigger || longTrigger) {
    const wall = shortTrigger ? resistanceAbove! : supportBelow!;
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: shortTrigger ? "short" : "long",
      detail: `Pin fade ${shortTrigger ? "off resistance" : "off support"} ${wall.strike} (spot ${desk.price}, γ=mean_revert, flow=${flow ?? "unknown"})`,
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
      ? `Regime ineligible for PB-04 (desk.regime=${desk.regime})`
      : !pinning
        ? `No gamma pin (gamma_regime=${desk.gamma_regime})`
        : breakingOut
          ? "Breakout through wall — pin fade invalidated"
          : `Pinned between walls, awaiting wall touch (res=${resistanceAbove?.strike ?? "—"} sup=${supportBelow?.strike ?? "—"})`,
  };
}

/**
 * PB-08 Power Hour Momentum — EVIDENCE-BACKED: 14:00+ ET was the only net-positive
 * hour band in the logged prod outcomes (avg +2.05 pts vs losses all morning).
 * Rides dominant late-day flow through a session-extreme break.
 */
function matchPb08(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number,
  regimeEligible: boolean
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[4];
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
  // "Net flow dominant one side 10m+" proxy: flow sign agrees with a sustained VWAP
  // side streak (bar history) — both must point the same way.
  const bullDominant = flow === "bullish" && technicals.minutes_above_vwap >= 10;
  const bearDominant = flow === "bearish" && technicals.minutes_below_vwap >= 10;
  const preconditionMatch = bullDominant || bearDominant;

  const longTrigger =
    regimeEligible && windowOpen && bullDominant && technicals.breakout.hod_break === true;
  const shortTrigger =
    regimeEligible && windowOpen && bearDominant && technicals.breakout.lod_break === true;

  if (longTrigger || shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      regime_eligible: regimeEligible,
      precondition_match: true,
      trigger_fired: true,
      direction: longTrigger ? "long" : "short",
      detail: `Power hour ${longTrigger ? "HOD" : "LOD"} break with dominant ${flow} flow (vwap streak ${longTrigger ? technicals.minutes_above_vwap : technicals.minutes_below_vwap}m)`,
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
      ? `Regime ineligible for PB-08 (desk.regime=${desk.regime})`
      : !windowOpen
        ? "Outside power hour (15:00–15:55 ET)"
        : preconditionMatch
          ? "Flow dominant — awaiting HOD/LOD break"
          : `No dominant flow (flow=${flow ?? "unknown"}, streaks ${technicals.minutes_above_vwap}m↑/${technicals.minutes_below_vwap}m↓)`,
  };
}

/**
 * Evaluate registry playbooks against desk/technicals and pick a deterministic primary.
 *
 * @param now injectable clock (ms epoch) for deterministic tests.
 */
export function matchPlaybooksShadow(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  now: number = Date.now()
): PlaybookShadowMatchResult {
  const etMins = etMinutes(new Date(now));
  const verdicts = [
    matchPb01(desk, technicals, etMins, isPlaybookEligible("PB-01", desk, now)),
    matchPb02(desk, technicals, etMins, isPlaybookEligible("PB-02", desk, now)),
    matchPb03(desk, technicals, etMins, isPlaybookEligible("PB-03", desk, now)),
    matchPb04(desk, technicals, etMins, isPlaybookEligible("PB-04", desk, now)),
    matchPb08(desk, technicals, etMins, isPlaybookEligible("PB-08", desk, now)),
  ];

  const primary = verdicts.find((v) => v.trigger_fired && v.regime_eligible);

  return {
    verdicts,
    primary_playbook_id: primary ? primary.playbook_id : null,
  };
}
