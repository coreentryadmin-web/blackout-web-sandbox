// NIGHT HAWK CORTEX — OVERNIGHT lens: shared types (PR-N5 of
// docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §4.3).
//
// This is the OVERNIGHT analogue of the intraday 0DTE Cortex
// (src/lib/nighthawk/cortex/): every source contributes a signed, bounded,
// timestamped OvernightEvidenceItem; the composer folds them into an
// OvernightVerdict with the SAME precision-first asymmetry the intraday lens uses
// — supports are capped per source (one loud bullish fact can never buy a play),
// vetoes are unbounded hard blocks (one loud bearish/binary fact kills a play).
//
// The difference is the SOURCES and the CLOCK. The overnight lens runs ONCE per
// night at edition-publish time (no 2.5s intraday budget), over data the evening
// build already fetched (ctx + per-ticker dossiers), scoring the survival of each
// candidate over an OVERNIGHT HOLD rather than an intraday scalp. Its sources map
// 1:1 onto the forensic failure modes the deep-dive named:
//   - catalyst-veto      → §3.4 "the overnight killer": earnings/binary event
//                          before/at the play's horizon (the #1 next-day death).
//   - wall-migration     → §3.2: riding vs FIGHTING the multi-day GEX wall.
//   - darkpool-trend     → §3.4 dark-pool accumulation direction vs the play.
//   - iv-term            → §4.1 overnight theta/vega cost of the thesis.
//   - sector-breadth     → N-4 "long-only monoculture": a long into a bearish
//                          sector/tape is a negative, not a neutral.
//   - flow-persistence   → the flagging flow must have PERSISTED into the close,
//                          not been a one-print splash.
//
// TYPES ONLY — no IO, no derivation. The pure composer (compose.ts, sources/*) and
// the edition-time assembler (build-inputs.ts) both depend on this without either
// depending on the other, exactly like the intraday cortex's types.ts.

/** The direction of the play the lens is asked to argue about. */
export type OvernightDirection = "long" | "short";

/**
 * Evidence stances. supports/opposes are bounded score contributions, veto is the
 * unbounded hard-block channel (precision-first asymmetry — one binary event kills
 * a play; no amount of bullish structure can un-kill it), and absent is the honest
 * "this source cannot answer right now" (visible, worth zero, never fabricated).
 */
export type OvernightStance = "supports" | "opposes" | "veto" | "absent";

/**
 * The fixed source registry, in composition order. Order matters only for
 * deterministic output ordering (narrative/evidence lists) — never for weighting.
 * catalyst-veto is FIRST by design: it is the dominant overnight killer (§3.4) and
 * the composer short-circuits nothing, but a reader scanning the narrative sees the
 * veto reason first.
 */
export const OVERNIGHT_SOURCES = [
  "catalyst-veto",
  "wall-migration",
  "darkpool-trend",
  "iv-term",
  "sector-breadth",
  "flow-persistence",
] as const;

export type OvernightSourceId = (typeof OVERNIGHT_SOURCES)[number];

/**
 * One signed, bounded, timestamped piece of overnight evidence.
 *
 * `weight` is the item's contribution magnitude — always a named constant from the
 * emitting source module, bounded by that source's support cap (for supports) or
 * bounded at emission (for opposes/vetoes). Unlike the intraday lens, the overnight
 * lens does NOT exponentially decay items: it runs once, at a single publish
 * instant, over same-evening data — there is no "40-min-old read" to fade. Sources
 * instead self-gate on data freshness (e.g. catalyst-veto only fires on an event
 * dated within the play's horizon; flow-persistence needs a real streak). `asOf` is
 * still carried so the persisted verdict records WHEN each reading was taken.
 *
 * `detail` is exactly one deterministic sentence; every numeric token in it must
 * trace to an OvernightInputs field or a documented arithmetic derivation of one —
 * the same no-fake-numbers discipline the intraday lens enforces.
 */
export type OvernightEvidenceItem = {
  source: OvernightSourceId;
  stance: OvernightStance;
  weight: number;
  /** When the underlying reading was taken (ISO). */
  asOf: string;
  detail: string;
};

/** The overnight verdict — the shape the edition builder gates on and pins into
 *  publish_context.cortex_overnight (§3.5 C-2 entry_context substrate). */
export type OvernightVerdictTag = "PASS" | "WEAK" | "VETO";

export type OvernightVerdict = {
  ticker: string;
  direction: OvernightDirection;
  /** The `now` the composition ran at (ISO). */
  asOf: string;
  /** The play's grading horizon (target session, YYYY-MM-DD) the lens scored against. */
  horizonDate: string;
  /** PASS = publish at full conviction; WEAK = publish flagged/lower conviction;
   *  VETO = do NOT publish (persist as nighthawk_rejected for counterfactual grading). */
  verdict: OvernightVerdictTag;
  /** True when EVERY source was absent (total lens outage) — the candidate then
   *  passes on the publish gates alone, flagged "no overnight evidence", rather than
   *  a total outage silently blocking the whole book (§ honesty: outage ⇒ abstain,
   *  not veto). Abstain always resolves to a PASS verdict with a flag. */
  abstained: boolean;
  /** Bounded Σ(per-source-capped supports) − Σ(opposes). Vetoes ride alongside. */
  score: number;
  vetoes: OvernightEvidenceItem[];
  supports: OvernightEvidenceItem[];
  opposes: OvernightEvidenceItem[];
  /** Sources that could not answer, as "source: reason" lines — visible, worth zero. */
  absent: string[];
  /** Machine-readable flags for the UI/debrief (e.g. "weak-overnight-evidence",
   *  "no-overnight-evidence", "catalyst-veto"). */
  flags: string[];
  /** Deterministic member-facing "why" lines — every number traces to an input. */
  narrative: string[];
};

// ---------------------------------------------------------------------------
// OvernightInputs — the snapshot the pure composer runs over
// ---------------------------------------------------------------------------

/** How a scheduled earnings report lands relative to the RTH session it is dated on. */
export type EarningsReportTime = "premarket" | "afterhours" | "unknown";

/** One known binary/dated event (FDA/PDUFA, M&A vote, etc.) on the ticker. */
export type OvernightBinaryEvent = {
  /** e.g. "fda", "pdufa", "m&a" — a coarse deterministic kind for the detail line. */
  kind: string;
  /** Event date, YYYY-MM-DD; null when the catalyst is undated (then it cannot veto). */
  date: string | null;
  /** Short human label for the detail sentence (already trimmed by build-inputs). */
  label: string;
};

/** catalyst-veto slice — the overnight killer's inputs (§3.4). */
export type OvernightCatalystSlice = {
  asOf: string;
  /** Scheduled earnings date for the ticker, YYYY-MM-DD; null when none is calendared. */
  earningsDate: string | null;
  /** Report time for that earnings date (drives whether it lands before/within the hold). */
  earningsReportTime: EarningsReportTime | null;
  /** Known dated binary events (FDA/PDUFA/M&A/etc.). */
  binaryEvents: OvernightBinaryEvent[];
  /** True when the candidate is EXPLICITLY a catalyst/earnings play — the one documented
   *  exemption to the hard veto (§3.4: "unless the candidate is explicitly flagged a
   *  catalyst play"). When true, an in-horizon event is the THESIS, not a landmine. */
  isCatalystPlay: boolean;
};

/** One ranked GEX wall level for the ticker. `kind` names the side. */
export type OvernightWall = { strike: number; kind: "call" | "put" };

/** One multi-day/session wall-history sample — the dominant opposing-side wall pct
 *  (share of ladder |gamma|) at a point in time. `time` is EPOCH SECONDS. */
export type OvernightWallSample = { time: number; opposingWallPct: number | null };

/** wall-migration slice — is the trade riding or FIGHTING the wall structure (§3.2). */
export type OvernightWallSlice = {
  asOf: string;
  spot: number | null;
  gammaFlip: number | null;
  /** Vector-style regime posture from spot vs flip. */
  regime: "long" | "short" | "transition" | "unknown";
  /** The dominant wall on the side the play must trade THROUGH (call wall for a long,
   *  put wall for a short); null when the ladder has no such wall. */
  opposingWall: OvernightWall | null;
  /** The play's target price — the path to it runs through opposingWall. */
  target: number | null;
  /** Multi-day/session opposing-wall strength samples (ascending by time), when the
   *  wall-history recorder persisted a rail for this ticker; [] when it did not. A
   *  BUILDING opposing wall (positive slope) that the play must fight = the veto case. */
  samples: OvernightWallSample[];
};

/** darkpool-trend slice — multi-day dark-pool accumulation direction (§3.4). */
export type OvernightDarkPoolSlice = {
  asOf: string;
  /** Aggregate dark-pool bias for the ticker (UW DarkPoolSnapshot.bias). */
  bias: "bullish" | "bearish" | "mixed" | "neutral" | "unknown";
  totalPremium: number;
  callPremium: number;
  putPremium: number;
};

/** iv-term slice — can the thesis afford the overnight theta/vega (§4.1). */
export type OvernightIvSlice = {
  asOf: string;
  /** IV rank 0–100; null when unavailable. */
  ivRank: number | null;
  /** IV term structure, nearest expiry first: [{expiry, iv}]. */
  term: Array<{ expiry: string; iv: number }>;
  realizedVol: number | null;
};

/** sector-breadth slice — sector heat + breadth vs the play direction (N-4). */
export type OvernightSectorSlice = {
  asOf: string;
  sectorName: string | null;
  /** Sector day change % (signed); null when unavailable. */
  sectorChangePct: number | null;
  /** Market breadth: fraction of names advancing (0–1); null when unavailable. */
  breadthAdvancingFrac: number | null;
  tickerChangePct: number | null;
};

/** flow-persistence slice — did the flagging flow persist into the close. */
export type OvernightFlowSlice = {
  asOf: string;
  /** Consecutive-day flow streak for the ticker (dossier.flow_streak.days). */
  streakDays: number | null;
  /** Count of qualifying flow prints behind the pick today. */
  flowCount: number | null;
  /** ISO timestamp of the LATEST qualifying print today; null when unknown — used to
   *  test whether the flow reached the back half of the session (persisted) vs a
   *  morning splash. */
  lastPrintAt: string | null;
};

/**
 * The full snapshot the composer runs over. Assembled by build-inputs.ts from the
 * edition's ALREADY-FETCHED structures (no new IO); every slice is null when its
 * extractor found nothing or threw — the corresponding source then reports `absent`
 * (visible, never fabricated). `errors` carries a per-source failure class so the
 * absent reason distinguishes "genuinely quiet" from "we could not see".
 */
export type OvernightInputs = {
  ticker: string;
  direction: OvernightDirection;
  /** The clock the composition treats as NOW (ISO). Threaded explicitly so no
   *  Date.now() hides inside the composer. */
  now: string;
  /** The play's grading horizon (target session, YYYY-MM-DD) — every "before/at the
   *  play's horizon" comparison in catalyst-veto measures against this. */
  horizonDate: string;
  catalyst: OvernightCatalystSlice | null;
  wall: OvernightWallSlice | null;
  darkPool: OvernightDarkPoolSlice | null;
  iv: OvernightIvSlice | null;
  sector: OvernightSectorSlice | null;
  flow: OvernightFlowSlice | null;
  errors: Partial<Record<OvernightSourceId, string>>;
};

/** Uniform source-module signature: pure derivation from the snapshot. A source
 *  returns [] only when it genuinely has nothing to say AND nothing to disclose; the
 *  normal "can't answer" path is a single absent-stance item with the reason. */
export type OvernightSourceFn = (input: OvernightInputs) => OvernightEvidenceItem[];
