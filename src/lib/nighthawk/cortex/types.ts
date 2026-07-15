// NIGHT HAWK CORTEX — shared types (PR-A of docs/audit/NIGHTHAWK-CORTEX-DESIGN.md).
//
// One evidence composer for 0DTE: every platform data source contributes a signed,
// bounded, timestamped EvidenceItem; the composer folds them into a CortexVerdict
// (design doc §0/§2). This module is TYPES ONLY — no IO, no derivation logic — so
// both the pure composer (compose.ts, sources/*) and the IO assembler (fetch.ts)
// depend on it without either depending on the other.
//
// The input contract (CortexInputs) deliberately MIRRORS the shapes of the existing
// readers (Vector full state, GEX positioning, HELIX flow tape, Benzinga-via-Polygon
// news, sector performance) rather than importing them: the design's own rule is
// that the composer must be pure over a snapshot (fully unit-testable, no Vector/BIE
// internals in the money path — design §0 "one evidence composer", build plan §4
// PR-A "reads via the EXISTING composers"). fetch.ts owns the mapping from the real
// reader outputs to these slices.

/** The direction of the play the Cortex is asked to argue about. */
export type CortexDirection = "long" | "short";

/**
 * Evidence stances (design §0): supports/opposes are bounded score contributions,
 * veto is the unbounded hard-block channel (precision-first asymmetry — one loud
 * bearish fact can kill an entry; one loud bullish signal can never buy one), and
 * absent is the honest "this source cannot answer right now" (visible, worth zero,
 * never fabricated).
 */
export type CortexStance = "supports" | "opposes" | "veto" | "absent";

/**
 * The fixed source registry, in composition order. Order matters only for
 * deterministic output ordering (narrative/evidence lists) — never for weighting.
 * One entry per design-doc §1 debate section that PR-A ships:
 *  - gex-walls            — Vector GEX ladder: wallPathCheck + regime-style match
 *  - wall-trend           — Vector bead HISTORY: the flagship wall-lifecycle signal
 *  - flow-quality         — Helix print texture: sweep clusters vs opposing whales
 *  - sector-heat          — Thermal sector/breadth alignment
 *  - catalyst-news        — BIE news/earnings/catalyst discrimination
 *  - vex-charm            — VEX direction + the documented charm heuristic
 *  - darkpool-confluence  — dark-pool level × wall confluence bonus
 *  - opening-harvest      — 9:30–9:45 ET opening character (0DTE-BREAKTHROUGH-LEDGER B-2)
 * (The SPX Slayer desk is deliberately NOT a Cortex source: it is already G-1's
 * bias/veto input in the gate stack — design §1 "nothing new to build".)
 */
export const CORTEX_SOURCES = [
  "gex-walls",
  "wall-trend",
  "flow-quality",
  "sector-heat",
  "catalyst-news",
  "vex-charm",
  "darkpool-confluence",
  "opening-harvest",
] as const;

export type CortexSourceId = (typeof CORTEX_SOURCES)[number];

/**
 * One signed, bounded, timestamped piece of evidence (design §0).
 *
 * `weight` is the item's contribution magnitude. On items EMITTED BY A SOURCE it is
 * the raw (undecayed) weight — always a named constant from that source module,
 * bounded by the source's support cap. On items in a CortexVerdict it is the
 * DECAYED, CAP-SCALED effective contribution the score actually used, so the member
 * evidence table shows what each item was really worth at `verdict.asOf`.
 *
 * `detail` is exactly one deterministic sentence; every numeric token in it must
 * trace to a CortexInputs field or a documented arithmetic derivation of one — the
 * same no-fake-numbers discipline as src/lib/bie/spx-live-voice.guard.test.ts,
 * enforced for the Cortex by narrative.guard.test.ts.
 */
export type EvidenceItem = {
  source: CortexSourceId;
  stance: CortexStance;
  weight: number;
  /** Exponential half-life of this evidence, seconds (design §0 "evidence decay"). */
  halfLifeSec: number;
  /** When the underlying reading was taken (ISO) — decay runs off THIS, not fetch time. */
  asOf: string;
  detail: string;
};

/** Display conviction. Capped at "A": the A+/85+ tier is mis-calibrated on every
 *  surface that has data (NIGHTHAWK-0DTE-DECISION.md F-5 / C-1) — the Cortex never
 *  emits a band above A while that inversion is open. */
export type CortexConviction = "A" | "B" | "C";

/** The composed verdict (design §2, verbatim shape). */
export type CortexVerdict = {
  ticker: string;
  direction: CortexDirection;
  /** The `now` the composition ran at (ISO) — decay/staleness were computed vs this. */
  asOf: string;
  /** Any non-empty → the gate stack blocks the commit (design §2 wiring). */
  vetoes: EvidenceItem[];
  /** Bounded sum of decayed, per-source-capped contributions: Σsupports − Σopposes. */
  score: number;
  supports: EvidenceItem[];
  opposes: EvidenceItem[];
  /** Sources that could not answer, as "source: reason" lines — visible, worth zero. */
  absent: string[];
  conviction: CortexConviction;
  /** Deterministic member-facing "why" lines — every number traces to an input. */
  narrative: string[];
};

// ---------------------------------------------------------------------------
// CortexInputs — the snapshot the pure composer runs over
// ---------------------------------------------------------------------------

/** One ranked gamma-wall level: strike + its share (0–100) of total |gamma| across
 *  the ladder. Mirrors GexWallLevel (src/lib/providers/gex-wall-levels.ts). */
export type CortexWall = { strike: number; pct: number };

/** Vector GEX ladder slice, 0DTE horizon (design §1 "Vector GEX ladder"). Walls are
 *  ranked strongest-first — [0] is the dominant wall per side, same convention as
 *  computeGexWalls / gex-positioning's call_wall/put_wall. */
export type CortexGexSlice = {
  asOf: string;
  spot: number;
  callWalls: CortexWall[];
  putWalls: CortexWall[];
  gammaFlip: number | null;
  /** Vector regime posture (spot vs flip) — sets the tape STYLE (design §1: long-gamma
   *  mean-reverts, short-gamma trends). Mirrors VectorRegimePosture. */
  regimePosture: "long" | "short" | "transition" | "unknown";
};

/** One wall-history rail sample. Mirrors WallHistorySample's wall payload
 *  (src/features/vector/lib/vector-wall-history.ts) — `time` is EPOCH SECONDS
 *  (the vector wall-trail 15s bucket convention, see vector-wall-sample.ts). */
export type CortexWallTrendSample = {
  time: number;
  callWalls: CortexWall[];
  putWalls: CortexWall[];
};

/** The session wall-history rail for the ticker — the bead lifecycle data behind the
 *  flagship wall-trend factor (design §1 "Vector bead HISTORY", §3.3). */
export type CortexWallTrendSlice = {
  asOf: string;
  /** Ascending by time (fetch.ts sorts; the source module re-sorts defensively). */
  samples: CortexWallTrendSample[];
};

/** Deterministic print texture class, tagged by fetch.ts from the UW alert rule
 *  (sweep rules → "sweep", floor/block rules → "block", anything else "other"). */
export type CortexFlowPrintKind = "sweep" | "block" | "other";

/** One HELIX flow print, reduced to what flow-quality needs. Direction follows the
 *  parser's TRUTH-MANDATE convention (unusual-whales.ts): an unparseable side stays
 *  "unknown" and never counts toward either cluster. */
export type CortexFlowPrint = {
  premium: number;
  direction: "bullish" | "bearish" | "unknown";
  kind: CortexFlowPrintKind;
  /** ISO print time; "" when upstream had no real timestamp (excluded from
   *  time-windowed clusters — never coerced to now, per the parser's '' sentinel). */
  at: string;
};

export type CortexFlowSlice = {
  asOf: string;
  prints: CortexFlowPrint[];
};

/** Thermal slice: the ticker's sector row (single names) or market breadth tone
 *  (index/ETF tickers) — design §1 "Thermal". */
export type CortexSectorSlice = {
  asOf: string;
  /** Sector ETF display name (e.g. "Technology"); null for index tickers. */
  sectorName: string | null;
  /** Sector ETF day change % (signed); null when unavailable/index. */
  sectorChangePct: number | null;
  /** Market breadth tone for index tickers (mirrors BreadthTone); null for single names. */
  breadthTone:
    | "strongly_positive"
    | "positive"
    | "mixed"
    | "negative"
    | "strongly_negative"
    | "unknown"
    | null;
  /** The ticker's own day change % (from GEX positioning), for the narrative only. */
  tickerChangePct: number | null;
};

/** One Benzinga-via-Polygon news item, reduced to the deterministic tagging surface
 *  (channels + headline keywords — design §1 BIE: "no LLM in the money path"). */
export type CortexNewsItem = {
  headline: string;
  channels: string[];
  /** ISO-ish publish time as Benzinga returns it. */
  publishedAt: string;
  tickers: string[];
};

export type CortexNewsSlice = {
  asOf: string;
  items: CortexNewsItem[];
  /** Set when the ticker reports earnings TODAY (from uw-earnings days_until === 0);
   *  the report-time drives the AMC long-premium opposition (design §1 BIE). */
  earningsToday: "premarket" | "afterhours" | "unknown" | null;
};

/** VEX/charm slice from the canonical GEX positioning read (design §1 "VEX/DEX/charm").
 *  NO charm numbers on purpose: the charm lens is not built yet (task #24) — the
 *  vex-charm source models charm as a time-of-day × pin-distance heuristic only. */
export type CortexVexSlice = {
  asOf: string;
  /** Net dealer dollar-VANNA across the matrix (signed); null when the matrix is cold. */
  netVex: number | null;
  /** The "GEX king" node (argmax |net-gamma| strike) — the pin anchor for the charm heuristic. */
  kingStrike: number | null;
};

export type CortexDarkPoolSlice = {
  asOf: string;
  /** Top institutional dark-pool levels (price + accumulated premium), strongest-first. */
  levels: Array<{ price: number; premium: number }>;
};

/** One session minute bar for the opening harvest. `time` is EPOCH SECONDS (matching
 *  the wall-trend sample convention; fetch.ts converts Polygon's ms `t`). */
export type CortexOpeningBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Opening-harvest slice (0DTE-BREAKTHROUGH-LEDGER.md B-2): today's early RTH minute
 *  bars, the prior session close (for the overnight gap), and the current market
 *  internals levels as the desk carries them (real I:TICK/I:ADD or the documented
 *  breadth proxy — src/lib/market-internals.ts). */
export type CortexOpeningSlice = {
  asOf: string;
  /** Today's RTH minute bars from the 9:30 ET open (the source reads only 9:30–9:45). */
  bars: CortexOpeningBar[];
  /** Prior session close; null when unavailable (gap classification then degrades
   *  to the gapless opening-drive branch, never a fabricated gap). */
  priorClose: number | null;
  tick: number | null;
  add: number | null;
};

/**
 * The full snapshot the composer runs over. Assembled by fetch.ts from EXISTING
 * readers only; every slice is null when its reader failed/timed out/had nothing —
 * the corresponding source then reports `absent` (visible, never fabricated).
 */
export type CortexInputs = {
  ticker: string;
  direction: CortexDirection;
  /** The clock the composition treats as NOW (ISO). Threaded explicitly so no
   *  Date.now() hides inside the composer — decay and the charm time-of-day
   *  heuristic are deterministic functions of this field. */
  now: string;
  /** Live spot for the ticker (walls/paths are measured from here). */
  spot: number | null;
  /** 1σ expected move in POINTS for the 0DTE horizon — the shared path yardstick
   *  every distance threshold (0.5×/0.25×/0.3×/0.1× EM) is expressed in. */
  expectedMovePts: number | null;
  gex: CortexGexSlice | null;
  wallTrend: CortexWallTrendSlice | null;
  flow: CortexFlowSlice | null;
  sector: CortexSectorSlice | null;
  news: CortexNewsSlice | null;
  vex: CortexVexSlice | null;
  darkPool: CortexDarkPoolSlice | null;
  opening: CortexOpeningSlice | null;
  /** Fail-soft error classes recorded by fetch.ts, keyed by the source(s) a failed
   *  reader feeds — surfaced verbatim in that source's absent reason. */
  errors: Partial<Record<CortexSourceId, string>>;
};

/** Uniform source-module signature: pure derivation from the snapshot. A source
 *  returns [] only when it genuinely has nothing to say AND nothing to disclose;
 *  the normal "can't answer" path is a single absent-stance item with the reason. */
export type CortexSourceFn = (input: CortexInputs) => EvidenceItem[];
