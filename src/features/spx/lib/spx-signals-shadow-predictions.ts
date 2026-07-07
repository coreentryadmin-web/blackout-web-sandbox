/**
 * SPX Slayer — SHADOW-MODE factor scoring for UW prediction-market consensus,
 * observed specifically around the engine's existing macro hard-block windows.
 * Sibling of src/lib/spx-signals-shadow.ts (the flow-anomaly shadow factor) —
 * same rules apply: structurally separate from src/lib/spx-signals.ts on
 * purpose (`computeSpxConfluence()` never imports this file, and nothing in
 * here is imported BY spx-signals.ts — `git grep spx-signals-shadow-predictions
 * src/lib/spx-signals.ts` returns nothing), so the "this cannot touch the real
 * score" guarantee is visible by inspection, not just by test.
 *
 * THE IDEA: src/lib/spx-play-gates.ts's `macroHardBlock()` is a binary,
 * all-or-nothing gate — ANY CPI/FOMC/FED/NFP/PPI/GDP release inside its window
 * blocks every new 0DTE entry, regardless of which way the release actually
 * breaks. UW's prediction-market consensus (fetchUwPredictionsConsensus in
 * src/lib/providers/unusual-whales.ts — insiders/smart-money/unusual/whales
 * options-flow-derived directional reads, already used the same way by
 * NightHawk in src/lib/nighthawk/market-wide.ts and dossier.ts) MIGHT carry
 * pre-positioning information about which way a macro surprise breaks. This
 * module logs, purely for later evidence-gathering (bie/calibration.ts's own
 * n>=10-evidence-before-acting precedent — see spx-signals-shadow.ts's module
 * doc for the full rationale), what a "lean into the direction prediction
 * markets are leaning, instead of blocking outright" refinement WOULD have
 * read at each macro window — zero live effect until a future, separately
 * reviewed change ever promotes this into macroHardBlock's actual gating logic
 * (which this module never touches, imports, or is imported by).
 *
 * NOT touching spx-play-gates.ts: `macroHardBlock()` and the pure ET-window
 * helpers it calls (parseMacroEventTime/macroBlockWindow in
 * spx-macro-window.ts) are the real gate's own logic — those two helpers ARE
 * reused here (already dependency-free, exported, pure) because they are
 * genuinely shared time-window math, not gating decisions. `macroHardBlock`
 * itself stays private to spx-play-gates.ts and untouched; its own
 * CPI/FOMC/FED/NFP/PAYROLL/PPI/GDP keyword predicate is intentionally
 * DUPLICATED below (not imported) to keep this file's "never imported by /
 * never imports the real gate" structural guarantee — mirrors the existing
 * kept-in-sync-by-comment precedent already in this codebase (see
 * SHADOW_ANOMALY_LOOKBACK_MINUTES's comment in spx-signal-log.ts). If
 * macroHardBlock's keyword list or window sizing ever changes, update
 * isHardBlockMacroTitle/NEAR_WINDOW_LEAD_MINUTES below to match.
 *
 * Everything below is a pure function: no DB reads, no fetch, no bare
 * `Date.now()`/`new Date()` (the caller passes `now` explicitly) — so it is
 * fully unit-testable and structurally incapable of a side effect on the real
 * signal.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";
import { parseMacroEventTime, macroBlockWindow } from "@/features/spx/lib/spx-macro-window";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";

export type ShadowFactorObservation = {
  /** e.g. "macro_prediction_cpi" — stable per macro-event family (not per single
   *  event instance) so evidence-gathering can bucket CPI vs FOMC vs NFP separately
   *  (calibration.ts precedent: bucket first, act only once a bucket clears n>=10). */
  factor_name: string;
  /** false when the underlying read could not be confirmed fresh — see the
   *  module doc above. Must NEVER be collapsed with "confirmed no signal". */
  available: boolean;
  /** What this factor WOULD have contributed on the real ±3-to-±18 scale
   *  computeSpxConfluence() uses (src/lib/spx-signals.ts) — explicitly
   *  provisional/unproven, see CONSENSUS_WEIGHT_TIERS below for the rationale. */
  implied_weight: number;
  direction: "bullish" | "bearish" | "neutral";
  detail: string;
};

/**
 * Broad-market proxies only — a macro CPI/FOMC/NFP surprise is a market-wide
 * event, not a single-name one, so (unlike spx-signals-shadow.ts's mega-cap
 * flow-anomaly universe) this deliberately does NOT include AAPL/NVDA/etc.
 * SPY is the same SPX proxy this codebase already leans on elsewhere (see
 * uw-lit-dark-ratio.ts's "SPY proxy" comment); QQQ is included as a second,
 * independent broad-market read so a single-ticker glitch can't masquerade as
 * "market consensus."
 */
export const MACRO_PREDICTION_TICKERS: readonly string[] = ["SPY", "QQQ"];

/**
 * How far BEFORE a macro window's real hard-block start this factor starts
 * observing ("near"). The whole point of this shadow factor is to see whether
 * prediction-market consensus was ALREADY leaning a direction before the real
 * block engages (pre-positioning), not just during the blocked minutes
 * themselves — so "near" deliberately extends earlier than macroHardBlock's
 * own window, never later (once the window ends, the surprise has already
 * broken and there is nothing left to "predict").
 */
const NEAR_WINDOW_LEAD_MINUTES = 30;

/**
 * Below this UW consensus confidence_pct, a directional read is treated as
 * "not clear enough" even if the API itself already called a bullish/bearish
 * lean (fetchUwPredictionsConsensus's own parsePredictionRow requires only a
 * >5pt bullish/bearish split to assign a direction — too low a bar to log as
 * "clear" here). Provisional, not backtested — see CONSENSUS_WEIGHT_TIERS.
 */
const CONSENSUS_CLEAR_MIN_PCT = 65;

/**
 * Provisional weight scale — NOT derived from any backtest, and explicitly not
 * meant to be trusted until a factor_name bucket clears bie/calibration.ts's
 * MIN_EVIDENCE = 10 evidence bar (same rationale as spx-signals-shadow.ts's
 * SEVERITY_WEIGHT). Chosen to land inside the real engine's own ±3 (Dark pool)
 * to ±18 (GEX wall) range: a bare-minimum "clear" read (just past
 * CONSENSUS_CLEAR_MIN_PCT) gets Dark-pool-tier weight, and only a
 * near-unanimous 90%+ consensus reaches GEX-wall-tier weight — this is a
 * single, market-wide, options-flow-DERIVED read of one already-known event,
 * not a multi-factor technical confluence, so it deliberately never claims the
 * top of the real engine's range without a much higher confidence bar than any
 * single real factor requires.
 */
const CONSENSUS_WEIGHT_TIERS: ReadonlyArray<{ min_pct: number; weight: number }> = [
  { min_pct: 90, weight: 18 },
  { min_pct: 80, weight: 13 },
  { min_pct: 70, weight: 9 },
  { min_pct: CONSENSUS_CLEAR_MIN_PCT, weight: 5 },
];

function weightForConfidence(pct: number): number {
  for (const tier of CONSENSUS_WEIGHT_TIERS) {
    if (pct >= tier.min_pct) return tier.weight;
  }
  return 0;
}

/** Mirrors macroHardBlock's own `isMacro` predicate in spx-play-gates.ts verbatim
 *  (see module doc — duplicated on purpose, not imported). */
function isHardBlockMacroTitle(title: string): boolean {
  return (
    title.includes("CPI") ||
    title.includes("FOMC") ||
    title.includes("FED") ||
    title.includes("NFP") ||
    title.includes("PAYROLL") ||
    title.includes("PPI") ||
    title.includes("GDP")
  );
}

/** Short, stable slug for factor_name grouping — CPI/FOMC/NFP/PPI/GDP behave
 *  differently enough (scheduled vs Fed-discretionary, single-number vs
 *  multi-metric) that they should evidence-bucket separately, mirroring
 *  spx-signals-shadow.ts's anomalyTypeSlug precedent. */
function macroEventSlug(title: string): string {
  if (title.includes("FOMC") || title.includes("FED") || title.includes("RATE DECISION")) return "fomc";
  if (title.includes("CPI")) return "cpi";
  if (title.includes("NFP") || title.includes("PAYROLL")) return "nfp";
  if (title.includes("PPI")) return "ppi";
  if (title.includes("GDP")) return "gdp";
  return "macro";
}

export type MacroWindowState = {
  /** true when `now` falls inside the SAME [start,end] window macroHardBlock
   *  would hard-block a real entry for right now. */
  active: boolean;
  /** true when `active`, OR within NEAR_WINDOW_LEAD_MINUTES BEFORE the window's
   *  start (pre-positioning lead — see NEAR_WINDOW_LEAD_MINUTES doc). false means
   *  this shadow factor has no applicable premise right now. */
  near: boolean;
  /** "cpi" | "fomc" | "nfp" | "ppi" | "gdp" | "macro" | null (null only when
   *  `near` is false). */
  event_slug: string | null;
  /** Upper-cased event title/label, truncated for logging — null when `near` is false. */
  event_title: string | null;
};

/**
 * Determine whether `now` is inside or approaching one of macroHardBlock's own
 * CPI/FOMC/FED/NFP/PAYROLL/PPI/GDP windows, using desk.macro_events (the SAME
 * field macroHardBlock reads — see src/lib/providers/spx-desk.ts, populated by
 * mergeMacroEventsToday, already filtered to TODAY's ET calendar date) and the
 * SAME parseMacroEventTime/macroBlockWindow helpers macroHardBlock itself calls
 * (src/lib/spx-macro-window.ts). Read-only: never mutates, never gates
 * anything — purely tells the caller whether it is worth reading prediction
 * consensus data at all right now.
 *
 * When multiple macro events are relevant, an ACTIVE match always wins over a
 * merely-NEAR one (an active real hard-block is always the more important
 * state to observe); among equally-ranked matches, the first in iteration
 * order wins, same tie-break macroHardBlock itself uses.
 */
export function resolveMacroWindowState(
  desk: SpxDeskPayload,
  now: number = Date.now()
): MacroWindowState {
  const events = desk.macro_events ?? [];
  const nowDate = new Date(now);
  const todayYmd = todayEtYmd(nowDate);
  const mins = etMinutes(nowDate);

  let nearMatch: MacroWindowState | null = null;

  for (const ev of events) {
    const title = String(ev.event ?? ev.country ?? "").toUpperCase();
    if (!isHardBlockMacroTitle(title)) continue;

    const evTime = parseMacroEventTime(String(ev.time ?? ""), todayYmd);
    if (evTime == null) continue;

    const isAfternoonFed = title.includes("FOMC") || title.includes("FED") || title.includes("RATE DECISION");
    let start: number;
    let end: number;
    if (isAfternoonFed) {
      // Same fallback-to-14:00 rule macroHardBlock applies for an imprecise/absent Fed time.
      const fedMins = evTime.precise && evTime.minutes >= 12 * 60 ? evTime.minutes : 14 * 60;
      start = fedMins - 15;
      end = fedMins + 15;
    } else {
      const win = macroBlockWindow(evTime);
      start = win.start;
      end = win.end;
    }

    const active = mins >= start && mins <= end;
    const near = active || (mins >= start - NEAR_WINDOW_LEAD_MINUTES && mins < start);
    if (!near) continue;

    const state: MacroWindowState = {
      active,
      near: true,
      event_slug: macroEventSlug(title),
      event_title: title.slice(0, 40),
    };
    if (active) return state; // active always wins outright, regardless of iteration order
    if (!nearMatch) nearMatch = state;
  }

  return nearMatch ?? { active: false, near: false, event_slug: null, event_title: null };
}

/**
 * Shadow-score UW prediction-market consensus (SPY/QQQ) around macroHardBlock's
 * own CPI/FOMC/NFP/PPI/GDP windows. Returns what a "lean with consensus instead
 * of blocking outright" refinement WOULD have contributed; purely for logging.
 *
 * `consensusSignals`/`consensusFresh` follow the exact same discipline
 * spx-signals-shadow.ts's `flowFeedFresh` established: the caller (
 * src/lib/providers/spx-signal-log.ts) must pass a real freshness signal
 * distinct from "the array happened to be empty" — fetchUwPredictionsConsensus
 * NEVER throws (uwGetSafe swallows failures and returns null/[] — see
 * src/lib/providers/unusual-whales.ts), so an empty top_signals array is
 * genuinely ambiguous between "UW is down/misconfigured" and "no consensus
 * signal on SPY/QQQ specifically right now." When `consensusFresh` is false
 * (or `consensusSignals` is null), this returns `available: false` so a
 * downstream reader can never mistake "couldn't tell" for a real zero.
 *
 * Distinct from `available:false`: being OUTSIDE any macro window at all is a
 * CONFIRMED state (we know for certain this factor's premise doesn't apply
 * right now), not a data problem — so that case returns `available: true`,
 * `implied_weight: 0`, same as spx-signals-shadow.ts's "confirmed no anomaly"
 * reading, never conflated with the stale/missing-data case.
 *
 * @param now injectable clock (defaults to Date.now()) purely for deterministic
 *            tests — production call sites never pass this.
 */
export function computeMacroPredictionsShadowFactor(
  desk: SpxDeskPayload,
  consensusSignals: PredictionConsensusSignal[] | null,
  consensusFresh: boolean,
  now: number = Date.now()
): ShadowFactorObservation[] {
  const windowState = resolveMacroWindowState(desk, now);

  if (!windowState.near) {
    return [
      {
        factor_name: "macro_prediction_consensus",
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail:
          "No active/near macro hard-block window (CPI/FOMC/NFP/PPI/GDP) right now — shadow factor not applicable",
      },
    ];
  }

  const slug = windowState.event_slug ?? "macro";
  const factorName = `macro_prediction_${slug}`;
  const label = windowState.event_title ?? "macro event";
  const phase = windowState.active
    ? "active hard-block window"
    : `within ${NEAR_WINDOW_LEAD_MINUTES}min pre-window`;

  if (!consensusFresh || consensusSignals == null) {
    return [
      {
        factor_name: factorName,
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail: `${label} (${phase}) but UW prediction-market consensus not confirmed fresh/available — cannot read pre-macro positioning`,
      },
    ];
  }

  const matches = consensusSignals.filter((s) => MACRO_PREDICTION_TICKERS.includes(s.ticker));
  if (matches.length === 0) {
    return [
      {
        factor_name: factorName,
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `${label} (${phase}) — no SPY/QQQ prediction-market consensus signal currently available [shadow: not scored]`,
      },
    ];
  }

  const clear = matches.filter(
    (m) => m.direction !== "neutral" && m.confidence_pct >= CONSENSUS_CLEAR_MIN_PCT
  );
  const directions = new Set(clear.map((m) => m.direction));

  if (clear.length === 0 || directions.size > 1) {
    const detailBits = matches.map((m) => `${m.ticker} ${m.confidence_pct}% ${m.direction}`).join(", ");
    return [
      {
        factor_name: factorName,
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `${label} (${phase}) — consensus mixed/unclear (${detailBits}) [shadow: not scored]`,
      },
    ];
  }

  const dir = [...directions][0] as "bullish" | "bearish";
  const strongest = clear.reduce((a, b) => (b.confidence_pct > a.confidence_pct ? b : a));
  const magnitude = weightForConfidence(strongest.confidence_pct);
  const weight = dir === "bullish" ? magnitude : -magnitude;

  return [
    {
      factor_name: factorName,
      available: true,
      implied_weight: weight,
      direction: dir,
      detail: `${label} (${phase}) — UW consensus ${strongest.confidence_pct}% ${dir} on ${strongest.ticker} (${strongest.sources.join("+")}) [shadow: not scored]`,
    },
  ];
}
