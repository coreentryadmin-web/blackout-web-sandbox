import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { VolatilityContext } from "@/features/spx/lib/playbook-volatility-context";
import { scaledDistancePts } from "@/features/spx/lib/playbook-volatility-context";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";
import type { OpenPlayRow } from "@/features/spx/lib/spx-play-store";
import {
  playDynamicTrimMfePts,
  playDynamicTrailWindowPts,
  playThesisBreakDropPts,
  playThesisBreakScore,
  playTrimProgressPct,
  playTrailingStopBreakevenMfePts,
  playTrailingStopTrailMfePts,
  playTrailingStopTrailWindowPts,
} from "@/features/spx/lib/spx-play-config";
import { evaluateOpenThesisBreak } from "@/features/spx/lib/spx-play-thesis";

export type PlaybookExitAction = "HOLD" | "TRIM" | "SELL";

export type PlaybookExitSignal = {
  action: PlaybookExitAction;
  reason: string;
  priority: number;
};

export type PlaybookExitInput = {
  playbook_id: PlaybookId | null | undefined;
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  row: OpenPlayRow;
  direction: SpxPlayDirection;
  price: number;
  confluence_score: number;
  entry_score: number;
  mfe_pts: number;
  vol_ctx: VolatilityContext;
  desk_stale: boolean;
  force_exit: boolean;
};

export type PlaybookExitPlan = {
  signals: PlaybookExitSignal[];
  trim_zone: boolean;
  trailing_stop: number | null;
  thesis_break: boolean;
  trim_mfe_threshold: number;
  trail_window_pts: number;
};

function pickStrongest(signals: PlaybookExitSignal[]): PlaybookExitSignal | null {
  const ranked = signals.filter((s) => s.action !== "HOLD").sort((a, b) => b.priority - a.priority);
  return ranked[0] ?? null;
}

function pb01Exits(input: PlaybookExitInput): PlaybookExitSignal[] {
  const signals: PlaybookExitSignal[] = [];
  const vwap = input.desk.vwap;
  if (vwap == null) return signals;

  const prox = scaledDistancePts(8, input.vol_ctx);
  if (input.direction === "long" && input.price < vwap - prox) {
    signals.push({ action: "SELL", reason: "PB-01 VWAP reclaim lost", priority: 85 });
  }
  if (input.direction === "short" && input.price > vwap + prox) {
    signals.push({ action: "SELL", reason: "PB-01 VWAP reject invalidated", priority: 85 });
  }
  return signals;
}

function pb02Exits(input: PlaybookExitInput): PlaybookExitSignal[] {
  const signals: PlaybookExitSignal[] = [];
  const vwap = input.desk.vwap;
  if (vwap == null || !input.technicals?.available) return signals;

  if (
    input.direction === "short" &&
    (input.technicals.breakout.vwap_lost === false && input.price > vwap)
  ) {
    signals.push({ action: "SELL", reason: "PB-02 VWAP reclaimed — fade thesis dead", priority: 90 });
  }
  return signals;
}

function pb03Exits(input: PlaybookExitInput): PlaybookExitSignal[] {
  const signals: PlaybookExitSignal[] = [];
  const t = input.technicals;
  if (!t?.or_defined || t.or_high == null || t.or_low == null) return signals;

  const mid = (t.or_high + t.or_low) / 2;
  const buf = scaledDistancePts(2, input.vol_ctx);

  if (input.direction === "long" && input.price < mid - buf) {
    signals.push({ action: "SELL", reason: "PB-03 OR mid lost — continuation failed", priority: 88 });
  }
  if (input.direction === "short" && input.price > mid + buf) {
    signals.push({ action: "SELL", reason: "PB-03 OR mid reclaimed — continuation failed", priority: 88 });
  }
  return signals;
}

const PB04_REGIME_RELEASE_DEBOUNCE_POLLS = 3;
const pb04RegimeReleaseStreak = new Map<number, number>();

function pb04Exits(input: PlaybookExitInput): PlaybookExitSignal[] {
  const signals: PlaybookExitSignal[] = [];
  const walls = input.desk.gex_walls ?? [];
  if (!walls.length) return signals;

  const prox = scaledDistancePts(10, input.vol_ctx);
  const nearRes = walls
    .filter((w) => w.kind === "resistance")
    .some((w) => Math.abs(w.strike - input.price) <= prox);
  const nearSup = walls
    .filter((w) => w.kind === "support")
    .some((w) => Math.abs(w.strike - input.price) <= prox);

  if (input.direction === "short" && nearRes && input.mfe_pts >= scaledDistancePts(6, input.vol_ctx)) {
    signals.push({ action: "TRIM", reason: "PB-04 pin fade — scale at resistance", priority: 70 });
  }
  if (input.direction === "long" && nearSup && input.mfe_pts >= scaledDistancePts(6, input.vol_ctx)) {
    signals.push({ action: "TRIM", reason: "PB-04 pin fade — scale at support", priority: 70 });
  }

  if (input.desk.gamma_regime !== "mean_revert") {
    const streak = (pb04RegimeReleaseStreak.get(input.row.id) ?? 0) + 1;
    pb04RegimeReleaseStreak.set(input.row.id, streak);
    if (streak >= PB04_REGIME_RELEASE_DEBOUNCE_POLLS) {
      signals.push({ action: "SELL", reason: "PB-04 gamma pin released", priority: 82 });
    }
  } else {
    pb04RegimeReleaseStreak.delete(input.row.id);
  }
  return signals;
}

const EXIT_BY_PB: Partial<
  Record<PlaybookId, (input: PlaybookExitInput) => PlaybookExitSignal[]>
> = {
  "PB-01": pb01Exits,
  "PB-02": pb02Exits,
  "PB-03": pb03Exits,
  "PB-04": pb04Exits,
};

/** Per-playbook exit engine — PB-01…04 have bespoke rules; others use generic scaling only. */
export function evaluatePlaybookExitPlan(input: PlaybookExitInput): PlaybookExitPlan {
  const pb = input.playbook_id ?? null;
  const trimMult =
    pb === "PB-04" ? 0.75 : pb === "PB-02" ? 0.85 : pb === "PB-03" ? 1.1 : pb === "PB-01" ? 0.9 : 1;
  const trailMult =
    pb === "PB-04" ? 0.7 : pb === "PB-02" ? 0.8 : pb === "PB-03" ? 1.15 : pb === "PB-01" ? 0.85 : 1;
  const thesisMult =
    pb === "PB-04" ? 1.2 : pb === "PB-02" ? 1.15 : pb === "PB-03" ? 0.95 : pb === "PB-01" ? 1.1 : 1;

  const trimMfe = playDynamicTrimMfePts(input.desk.vix) * trimMult;
  const target = input.row.target;
  const totalRun = target != null ? Math.abs(target - input.row.entry_price) : 0;
  const progress =
    totalRun > 0
      ? input.direction === "long"
        ? (input.price - input.row.entry_price) / totalRun
        : (input.row.entry_price - input.price) / totalRun
      : 0;

  const trimZone =
    !input.desk_stale &&
    !input.row.trim_done &&
    input.mfe_pts >= trimMfe &&
    target != null &&
    progress >= (pb === "PB-04" ? 0.55 : playTrimProgressPct());

  const trailWindowPts =
    (playDynamicTrailWindowPts(input.desk.vix) ?? playTrailingStopTrailWindowPts()) * trailMult;

  let trailingStop: number | null = null;
  const trailBreakevenMfe = playTrailingStopBreakevenMfePts();
  const trailActiveMfe = playTrailingStopTrailMfePts();
  if (input.mfe_pts >= trailActiveMfe) {
    const peak =
      input.direction === "long"
        ? input.row.entry_price + input.mfe_pts
        : input.row.entry_price - input.mfe_pts;
    trailingStop =
      input.direction === "long" ? peak - trailWindowPts : peak + trailWindowPts;
  } else if (input.mfe_pts >= trailBreakevenMfe) {
    trailingStop = input.row.entry_price;
  }

  const thesisEval = evaluateOpenThesisBreak(
    input.direction,
    input.confluence_score,
    input.entry_score,
    { mfePts: input.mfe_pts, openedAtMs: new Date(input.row.opened_at).getTime() },
    {
      dropPts: playThesisBreakDropPts() * thesisMult,
      floor: playThesisBreakScore() * thesisMult,
    }
  );

  const signals: PlaybookExitSignal[] = [];
  if (input.force_exit) {
    signals.push({ action: "SELL", reason: "Theta/session force exit", priority: 100 });
  }

  const runner = pb ? EXIT_BY_PB[pb] : undefined;
  if (runner) signals.push(...runner(input));

  if (trimZone) {
    signals.push({ action: "TRIM", reason: `${pb ?? "generic"} trim zone`, priority: 60 });
  }

  if (thesisEval.broken) {
    signals.push({ action: "SELL", reason: "Thesis break", priority: 80 });
  }

  if (trailingStop != null) {
    const trailHit =
      input.direction === "long" ? input.price <= trailingStop : input.price >= trailingStop;
    if (trailHit && !input.desk_stale) {
      signals.push({ action: "SELL", reason: "Trailing stop", priority: 75 });
    }
  }

  const stop = input.row.stop;
  if (stop != null && !input.desk_stale) {
    const stopHit =
      input.direction === "long" ? input.price <= stop : input.price >= stop;
    if (stopHit) signals.push({ action: "SELL", reason: "Stop hit", priority: 95 });
  }

  if (target != null && !input.desk_stale) {
    const targetHit =
      input.direction === "long" ? input.price >= target : input.price <= target;
    if (targetHit) signals.push({ action: "SELL", reason: "Target hit", priority: 92 });
  }

  return {
    signals,
    trim_zone: trimZone,
    trailing_stop: trailingStop,
    thesis_break: thesisEval.broken,
    trim_mfe_threshold: trimMfe,
    trail_window_pts: trailWindowPts,
  };
}

export function strongestPlaybookExitSignal(plan: PlaybookExitPlan): PlaybookExitSignal | null {
  return pickStrongest(plan.signals);
}
