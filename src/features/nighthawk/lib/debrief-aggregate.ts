// PR-N10 — the Debrief, aggregate layer: rolling failure-mode counts, per-conviction
// (and per-tier, when a tier is ever pinned) records, counterfactual PUBLISH-GATE
// validation, and the machine-readable improvement queue.
//
// This is the Night Hawk analogue of zerodte/calibration.ts: pure core
// (analyzeNighthawkDebriefs + helpers) over rows the caller supplies, with a thin
// data layer at the bottom (buildNighthawkDebriefReport) doing dynamic RELATIVE
// imports. Same non-negotiables:
//  - LOW-N discipline is absolute: every bucket under the shared LOW_N_THRESHOLD is
//    flagged, and the improvement queue NEVER attaches a suggestion to low-n evidence
//    (the item still appears, suggestion: null — visible, not actionable).
//  - Anti-blend (#333): every record-shaped number is computed over CURRENT-methodology
//    rows only; legacy-graded rows are counted (`legacy_excluded`) and never bucketed.
//  - Counterfactuals are read from what the debrief cron PERSISTED (debrief-persist.ts
//    grades gate-blocked plays with the same daily-bar path grading uses) — this module
//    never grades anything itself, so the report is a pure read.

import type { NighthawkPlayOutcomeRow } from "@/lib/db";
// The one platform-wide LOW-N disclosure threshold (zerodte/record.ts) — same flag the
// 0DTE calibration report and the NH record cuts already use.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { isCurrentGradeMethodology } from "./grade-methodology";
import {
  DEBRIEF_FAILURE_MODES,
  type DebriefFailureMode,
} from "./debrief";
import { GATE_BAND_MAX_DISTANCE_PCT, GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";

export const NIGHTHAWK_DEBRIEF_METHODOLOGY =
  "Night Hawk session debrief over graded outcome rows (v2 fillability grades only — legacy-" +
  "methodology rows are counted but never bucketed, #333 anti-blend). Failure modes come from " +
  "each row's pinned debrief (first-write-wins, written by the outcomes cron after grading). " +
  "Publish-gate blocked value grades the gate-rejected plays counterfactually on the SAME " +
  "next-session daily bar the grader uses (underlying level-touch basis — option premium is " +
  "never fabricated); the published mirror retro-applies each gate's live threshold to the " +
  "pinned publish geometry of plays that DID publish. Buckets under n=" +
  `${LOW_N_THRESHOLD} are low_n and never produce a suggestion.`;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

// ── Row/pin shapes ──────────────────────────────────────────────────────────────────

/** The outcome-row slice the aggregate reads (structural subset so tests build small
 *  fixtures). `debrief` is the JSONB pin from debrief-persist.ts. */
export type DebriefAggregateRow = Pick<
  NighthawkPlayOutcomeRow,
  | "edition_for"
  | "ticker"
  | "direction"
  | "conviction"
  | "outcome"
  | "pulled"
  | "grade_methodology"
  | "publish_context"
  | "entry_range_low"
  | "entry_range_high"
  | "target"
  | "stop"
  | "debrief"
>;

/** Structural read of a pinned debrief — only the fields aggregation needs. A blob
 *  without a recognizable version + taxonomy tag is "no debrief on record", never a
 *  guess (same never-trust-a-JSON-column rule as every other pin reader). */
export function readPinnedDebriefTag(raw: unknown): DebriefFailureMode | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.debrief_version !== "number" || !Number.isFinite(d.debrief_version)) return null;
  const fm = d.failure_mode;
  if (fm == null || typeof fm !== "object") return null;
  const tag = (fm as Record<string, unknown>).tag;
  return typeof tag === "string" && (DEBRIEF_FAILURE_MODES as readonly string[]).includes(tag)
    ? (tag as DebriefFailureMode)
    : null;
}

/** Pinned publish-context tier, when one exists. No NH tier engine ships yet (decision
 *  doc PR-N7) — this reads the slot structurally so per-tier records light up the day a
 *  tier is pinned, with zero schema/aggregate changes then. */
export function readPinnedTier(publishContext: unknown): string | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const t = (publishContext as Record<string, unknown>).tier;
  return typeof t === "string" && t.length > 0 ? t.toUpperCase() : null;
}

// ── Summary (also served on the member record route — compact, segments-aware) ──────

export type DebriefTagCount = { tag: DebriefFailureMode; n: number };

export type NighthawkDebriefRecordSummary = {
  /** Current-methodology graded rows in the window (the anti-blend base). */
  graded: number;
  /** Of those, rows carrying a readable debrief pin. */
  debriefed: number;
  /** Distinct sessions (edition_for) among the debriefed rows. */
  sessions: number;
  /** Non-zero failure-mode counts, n desc then tag asc (stable machine shape). */
  failure_modes: DebriefTagCount[];
  /** Graded rows excluded for non-current grade methodology (#333 quarantine). */
  legacy_excluded: number;
  /** Current graded rows with no debrief pin yet (cron hasn't visited / pre-N10). */
  unpinned: number;
  /** debriefed < LOW_N_THRESHOLD — consumers must badge; nothing here is a record yet. */
  low_n: boolean;
};

/** Failure-mode counts over CURRENT-methodology graded rows only. Pure. */
export function summarizeDebriefPins(rows: DebriefAggregateRow[]): NighthawkDebriefRecordSummary {
  const graded = rows.filter((r) => r.outcome !== "pending");
  const current = graded.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
  const counts = new Map<DebriefFailureMode, number>();
  const sessions = new Set<string>();
  let debriefed = 0;
  for (const row of current) {
    const tag = readPinnedDebriefTag(row.debrief ?? null);
    if (tag == null) continue;
    debriefed += 1;
    sessions.add(row.edition_for);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const failure_modes = Array.from(counts.entries())
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  return {
    graded: current.length,
    debriefed,
    sessions: sessions.size,
    failure_modes,
    legacy_excluded: graded.length - current.length,
    unpinned: current.length - debriefed,
    low_n: debriefed < LOW_N_THRESHOLD,
  };
}

// ── Per-conviction / per-tier records ───────────────────────────────────────────────

export type DebriefGroupRecord = {
  key: string;
  n: number;
  /** Scoreable = excludes unfilled + pulled (same denominator rule as analytics.ts). */
  scoreable: number;
  wins: number;
  losses: number;
  unfilled: number;
  pulled: number;
  win_rate_pct: number | null;
  /** The group's most frequent debriefed failure mode (ties break lexicographically). */
  dominant_failure_mode: DebriefFailureMode | null;
  low_n: boolean;
};

function groupRecord(key: string, rows: DebriefAggregateRow[]): DebriefGroupRecord {
  const scoreable = rows.filter((r) => r.outcome !== "unfilled" && r.pulled !== true);
  const wins = scoreable.filter((r) => r.outcome === "target").length;
  const losses = scoreable.filter((r) => r.outcome === "stop").length;
  const counts = new Map<DebriefFailureMode, number>();
  for (const r of rows) {
    const tag = readPinnedDebriefTag(r.debrief ?? null);
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const dominant =
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    key,
    n: rows.length,
    scoreable: scoreable.length,
    wins,
    losses,
    unfilled: rows.filter((r) => r.outcome === "unfilled").length,
    pulled: rows.filter((r) => r.pulled === true).length,
    win_rate_pct: scoreable.length > 0 ? round1((wins / scoreable.length) * 100) : null,
    dominant_failure_mode: dominant,
    low_n: scoreable.length < LOW_N_THRESHOLD,
  };
}

const CONVICTION_ORDER = ["A+", "A", "B", "C"] as const;

function byConviction(current: DebriefAggregateRow[]): DebriefGroupRecord[] {
  return CONVICTION_ORDER.map((c) =>
    groupRecord(
      c,
      current.filter((r) => String(r.conviction ?? "").toUpperCase() === c)
    )
  );
}

function byTier(current: DebriefAggregateRow[]): DebriefGroupRecord[] {
  const map = new Map<string, DebriefAggregateRow[]>();
  for (const r of current) {
    const tier = readPinnedTier(r.publish_context ?? null);
    if (tier == null) continue;
    map.set(tier, [...(map.get(tier) ?? []), r]);
  }
  return Array.from(map.entries())
    .map(([tier, rows]) => groupRecord(tier, rows))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ── Counterfactual publish-gate validation ──────────────────────────────────────────

/** One gate-blocked play as the analyzer consumes it: the nighthawk_rejected audit row
 *  (stage publish_gate) joined with the counterfactual grade debrief-persist.ts pinned
 *  onto it (counterfactual_json; null when not yet graded). */
export type NighthawkGateRejectionInput = {
  ticker: string;
  edition_for: string;
  direction: "LONG" | "SHORT";
  /** Failed gate codes parsed from input_snapshot.gate_blocks (a DELL-class play
   *  carries band_detached AND target_unreachable — it counts under BOTH gates). */
  gate_codes: string[];
  counterfactual: unknown;
};

export type GateRejectionCounterfactualLike = {
  outcome: string;
  would_have_won: boolean;
};

/** Structural read of a persisted rejection counterfactual (never trust JSONB). */
export function readRejectionCounterfactual(raw: unknown): GateRejectionCounterfactualLike | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.outcome !== "string" || c.outcome === "ungradeable") return null;
  return { outcome: c.outcome, would_have_won: c.would_have_won === true };
}

/** Parse the failed gate codes out of a nighthawk_rejected row's input_snapshot. */
export function gateCodesFromSnapshot(inputSnapshot: unknown): string[] {
  if (inputSnapshot == null || typeof inputSnapshot !== "object") return [];
  const blocks = (inputSnapshot as Record<string, unknown>).gate_blocks;
  if (!Array.isArray(blocks)) return [];
  const codes: string[] = [];
  for (const b of blocks) {
    if (b != null && typeof b === "object" && typeof (b as Record<string, unknown>).code === "string") {
      codes.push((b as Record<string, unknown>).code as string);
    }
  }
  return Array.from(new Set(codes));
}

export type GateBlockedValueLine = {
  gate: string;
  /** All plays this gate blocked in the window. */
  blocked_n: number;
  /** Of those, counterfactually graded (persisted, non-ungradeable). */
  graded_n: number;
  ungraded_n: number;
  would_have_won: number;
  would_have_won_rate_pct: number | null;
  /** Counterfactual 'unfilled' — the blocked play wouldn't even have filled (the gate
   *  was trivially right for these; kept out of the won/lost read). */
  unfilled_n: number;
  low_n: boolean;
};

/** Per-gate "blocked value": how many plays each publish gate removed, and what the
 *  removed plays would have done. A gate that blocks winners shows up HERE — the only
 *  way a gate threshold earns or loses its number. */
export function gateBlockedValue(rejections: NighthawkGateRejectionInput[]): GateBlockedValueLine[] {
  const byGate = new Map<string, NighthawkGateRejectionInput[]>();
  for (const r of rejections) {
    for (const code of r.gate_codes) {
      byGate.set(code, [...(byGate.get(code) ?? []), r]);
    }
  }
  return Array.from(byGate.entries())
    .map(([gate, rows]) => {
      const cfs = rows.map((r) => readRejectionCounterfactual(r.counterfactual));
      const graded = cfs.filter((c): c is GateRejectionCounterfactualLike => c != null);
      const unfilled = graded.filter((c) => c.outcome === "unfilled");
      const decisive = graded.filter((c) => c.outcome !== "unfilled");
      const won = decisive.filter((c) => c.would_have_won).length;
      return {
        gate,
        blocked_n: rows.length,
        graded_n: graded.length,
        ungraded_n: rows.length - graded.length,
        would_have_won: won,
        would_have_won_rate_pct: decisive.length > 0 ? round1((won / decisive.length) * 100) : null,
        unfilled_n: unfilled.length,
        low_n: decisive.length < LOW_N_THRESHOLD,
      };
    })
    .sort((a, b) => b.blocked_n - a.blocked_n || a.gate.localeCompare(b.gate));
}

// ── The published mirror: what would each gate have blocked, from the pinned margins ─

export type GateMirrorBucket = {
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  low_n: boolean;
};

export type GateMirrorLine = {
  gate: "band_detached" | "target_unreachable";
  would_block: GateMirrorBucket;
  would_pass: GateMirrorBucket;
  /** would_pass WR minus would_block WR, pts — positive means the gate separates real
   *  losers from real winners on published history. Null until both buckets graded. */
  delta_win_rate_pts: number | null;
  /** Graded rows whose pin lacks the geometry this gate thresholds on. */
  no_geometry_n: number;
};

type PinGeometry = { band_distance_pct: number | null; atr14: number | null };

function pinGeometry(publishContext: unknown): PinGeometry {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) {
    return { band_distance_pct: null, atr14: null };
  }
  const p = publishContext as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return { band_distance_pct: num(p.band_distance_pct), atr14: num(p.atr14) };
}

/** Retro would-block verdict for one published row, using the LIVE gate thresholds
 *  (publish-gates.ts constants — the same numbers that block tonight) against the
 *  geometry PINNED at publish. Null = the pin can't answer for this gate.
 *  G-N3 (stale quote) is deliberately absent: its "acceptable sessions" input is a
 *  clock-relative fact that cannot be honestly reconstructed for history. */
export function retroWouldBlock(
  row: Pick<DebriefAggregateRow, "publish_context" | "direction" | "entry_range_low" | "entry_range_high" | "target">,
  gate: "band_detached" | "target_unreachable"
): boolean | null {
  const geo = pinGeometry(row.publish_context ?? null);
  if (gate === "band_detached") {
    if (geo.band_distance_pct == null) return null;
    return Math.abs(geo.band_distance_pct) > GATE_BAND_MAX_DISTANCE_PCT;
  }
  const fillEdge = (row.direction === "SHORT" ? row.entry_range_low : row.entry_range_high) ?? null;
  if (geo.atr14 == null || geo.atr14 <= 0 || fillEdge == null || row.target == null) return null;
  return Math.abs(row.target - fillEdge) / geo.atr14 > GATE_TARGET_MAX_ATR_MULTIPLE;
}

function mirrorBucket(rows: DebriefAggregateRow[]): GateMirrorBucket {
  const wins = rows.filter((r) => r.outcome === "target").length;
  const losses = rows.filter((r) => r.outcome === "stop").length;
  return {
    n: rows.length,
    wins,
    losses,
    win_rate_pct: rows.length > 0 ? round1((wins / rows.length) * 100) : null,
    low_n: rows.length < LOW_N_THRESHOLD,
  };
}

/** The mirror over PUBLISHED plays: bucket current-methodology SCOREABLE rows by each
 *  gate's retro would-block verdict (from the pinned PASS margins / geometry). */
export function gatePublishedMirror(current: DebriefAggregateRow[]): GateMirrorLine[] {
  const scoreable = current.filter((r) => r.outcome !== "unfilled" && r.pulled !== true && r.outcome !== "pending");
  return (["band_detached", "target_unreachable"] as const).map((gate) => {
    const block: DebriefAggregateRow[] = [];
    const pass: DebriefAggregateRow[] = [];
    let noGeo = 0;
    for (const r of scoreable) {
      const verdict = retroWouldBlock(r, gate);
      if (verdict == null) noGeo += 1;
      else (verdict ? block : pass).push(r);
    }
    const wouldBlock = mirrorBucket(block);
    const wouldPass = mirrorBucket(pass);
    const delta =
      wouldBlock.win_rate_pct != null && wouldPass.win_rate_pct != null
        ? round1(wouldPass.win_rate_pct - wouldBlock.win_rate_pct)
        : null;
    return { gate, would_block: wouldBlock, would_pass: wouldPass, delta_win_rate_pts: delta, no_geometry_n: noGeo };
  });
}

// ── The improvement queue ───────────────────────────────────────────────────────────

/** Machine-readable improvement signal. `suggestion` is NULL whenever `low_n` is true —
 *  the LOW-N discipline in executable form: thin evidence is VISIBLE (the item ships)
 *  but never ACTIONABLE (no suggestion can rest on it). */
export type DebriefImprovementItem = {
  signal: string;
  evidence: { n: number; delta: number | null };
  suggestion: string | null;
  low_n: boolean;
};

/** A dominant failure mode must cover at least this share of debriefed plays before it
 *  earns a queue item — below it the mix is noise, not a pattern. */
export const IMPROVEMENT_DOMINANT_SHARE = 0.4;
/** Blocked-value: a gate whose graded counterfactuals would have won at/above this rate
 *  is flagged as possibly blocking winners. */
export const IMPROVEMENT_BLOCKED_WINNER_RATE_PCT = 40;
/** Mirror: retro delta (pts) at/above this reads as "the gate separates real losers".
 *  Same bar as the 0DTE calibration graduation delta (calibration.ts). */
export const IMPROVEMENT_MIRROR_DELTA_PTS = 15;

const FAILURE_MODE_SUGGESTION: Record<DebriefFailureMode, string> = {
  clean_win: "wins are clean — protect the current publish discipline; change nothing on this evidence",
  lucky_win:
    "wins are consuming most of their stop budget before paying — risk plans are too tight to the tape; widen stops or demand better entries",
  gap_win:
    "gap-away 'wins' are appearing in a current-methodology segment — grading regression; audit resolveOutcome fillability immediately",
  stopped_normal: "losses are ordinary in-plan stop-outs — the leak, if any, is selection, not execution",
  wrong_direction:
    "direction calls themselves are failing — add a book-vs-tape alignment veto at publish (decision doc N-4/PR-N9 class)",
  gap_through_stop:
    "losses are being decided by overnight gaps, not intraday action — publish-time catalyst/gap-risk veto + binding pre-open pull are the levers (N-7/§3.4 class)",
  target_unreachable:
    "targets are exceeding the one-session horizon — tighten the G-N2 achievable-target multiple toward 1.0× ATR (publish-gates.ts)",
  band_detached:
    "entry bands are publishing detached from the tape — G-N1 is the lever; verify the stale-quote guard and backfill anchoring (N-3 class)",
  unfilled_never_traded_back:
    "bands are near-missing fills — entries are anchored too far from spot for the session's range; re-anchor toward spot at publish",
  pulled_correctly:
    "the morning pull latch is removing plays that would have lost — keep INVALIDATED binding (N-7 working as designed)",
  pulled_wrongly:
    "the morning pull latch is removing plays that would have WON — recalibrate the INVALIDATED thresholds before trusting more pulls",
};

/** Deterministic queue builder. Items sort actionable-first (suggestion-bearing, then
 *  larger n, then signal) so the top of the queue is always the strongest evidence. */
export function buildImprovementQueue(input: {
  summary: NighthawkDebriefRecordSummary;
  blockedValue: GateBlockedValueLine[];
  mirror: GateMirrorLine[];
  byConviction: DebriefGroupRecord[];
}): DebriefImprovementItem[] {
  const items: DebriefImprovementItem[] = [];

  // 1) Dominant failure mode among debriefed plays.
  const top = input.summary.failure_modes[0];
  if (top && input.summary.debriefed > 0) {
    const share = top.n / input.summary.debriefed;
    if (share >= IMPROVEMENT_DOMINANT_SHARE) {
      const lowN = input.summary.debriefed < LOW_N_THRESHOLD;
      items.push({
        signal: `failure_mode:${top.tag}:dominant`,
        evidence: { n: top.n, delta: round1(share * 100) },
        suggestion: lowN ? null : FAILURE_MODE_SUGGESTION[top.tag],
        low_n: lowN,
      });
    }
  }

  // 2) Per-gate blocked value: is a gate removing winners?
  for (const line of input.blockedValue) {
    if (line.graded_n === 0 || line.would_have_won_rate_pct == null) continue;
    const blocksWinners = line.would_have_won_rate_pct >= IMPROVEMENT_BLOCKED_WINNER_RATE_PCT;
    items.push({
      signal: `publish_gate:${line.gate}:blocked_value`,
      evidence: { n: line.graded_n, delta: line.would_have_won_rate_pct },
      suggestion: line.low_n
        ? null
        : blocksWinners
          ? `gate ${line.gate} blocked plays that would have won ${line.would_have_won_rate_pct}% of the time — re-examine its threshold against the PASS margins pinned in publish_context.gates`
          : `gate ${line.gate} is blocking non-winners (${line.would_have_won_rate_pct}% would-have-won) — the threshold is earning its keep; keep enforcing`,
      low_n: line.low_n,
    });
  }

  // 3) Published mirror: does retro-applying the gate separate losers from winners?
  for (const line of input.mirror) {
    if (line.delta_win_rate_pts == null) continue;
    const lowN = line.would_block.low_n || line.would_pass.low_n;
    const strong = line.delta_win_rate_pts >= IMPROVEMENT_MIRROR_DELTA_PTS;
    items.push({
      signal: `publish_gate:${line.gate}:published_mirror`,
      evidence: { n: line.would_block.n + line.would_pass.n, delta: line.delta_win_rate_pts },
      suggestion: lowN
        ? null
        : strong
          ? `plays the ${line.gate} gate would have blocked ran ${line.delta_win_rate_pts} pts worse than passes on the published record — the threshold separates real losers; hold or tighten`
          : `retro-applying ${line.gate} does not separate winners from losers (${line.delta_win_rate_pts} pts) — do not tighten on this evidence`,
      low_n: lowN,
    });
  }

  // 4) Conviction inversion (the F-5/N-6 family): a lower conviction band beating a
  //    higher one by >10 pts at usable n means the letters are mis-weighted.
  const usable = input.byConviction.filter((c) => c.win_rate_pct != null);
  for (let hi = 0; hi < usable.length; hi += 1) {
    for (let lo = hi + 1; lo < usable.length; lo += 1) {
      const higher = usable[hi]!;
      const lower = usable[lo]!;
      const delta = (lower.win_rate_pct ?? 0) - (higher.win_rate_pct ?? 0);
      if (delta > 10) {
        const lowN = higher.low_n || lower.low_n;
        items.push({
          signal: `conviction:${higher.key}_below_${lower.key}:inversion`,
          evidence: { n: higher.scoreable + lower.scoreable, delta: round1(delta) },
          suggestion: lowN
            ? null
            : `conviction ${lower.key} outperforms ${higher.key} by ${round1(delta)} pts — the conviction letters are mis-weighted (N-6); port the earned-tier engine (decision doc PR-N7)`,
          low_n: lowN,
        });
      }
    }
  }

  // Actionable first, then evidence size, then stable name order.
  return items.sort(
    (a, b) =>
      Number(a.low_n) - Number(b.low_n) || b.evidence.n - a.evidence.n || a.signal.localeCompare(b.signal)
  );
}

// ── The full report ─────────────────────────────────────────────────────────────────

export type NighthawkDebriefReport = {
  methodology: string;
  window: { since: string; through: string; days: number };
  summary: NighthawkDebriefRecordSummary;
  by_conviction: DebriefGroupRecord[];
  /** Empty until a tier is ever pinned in publish_context (no NH tier engine yet). */
  by_tier: DebriefGroupRecord[];
  gate_validation: {
    blocked_value: GateBlockedValueLine[];
    published_mirror: GateMirrorLine[];
  };
  improvement_queue: DebriefImprovementItem[];
  available: boolean;
};

/** The pure analyzer: graded rows + gate rejections in, report out. Deterministic —
 *  no clock, no IO. */
export function analyzeNighthawkDebriefs(input: {
  rows: DebriefAggregateRow[];
  rejections: NighthawkGateRejectionInput[];
  window: { since: string; through: string; days: number };
}): NighthawkDebriefReport {
  const graded = input.rows.filter((r) => r.outcome !== "pending");
  const current = graded.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
  const summary = summarizeDebriefPins(input.rows);
  const conviction = byConviction(current);
  const blockedValue = gateBlockedValue(input.rejections);
  const mirror = gatePublishedMirror(current);
  return {
    methodology: NIGHTHAWK_DEBRIEF_METHODOLOGY,
    window: input.window,
    summary,
    by_conviction: conviction,
    by_tier: byTier(current),
    gate_validation: { blocked_value: blockedValue, published_mirror: mirror },
    improvement_queue: buildImprovementQueue({ summary, blockedValue, mirror, byConviction: conviction }),
    available: summary.debriefed > 0 || blockedValue.length > 0,
  };
}

// ── Thin data layer ─────────────────────────────────────────────────────────────────

function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;

/**
 * Fetch + analyze. `nowMs` is a parameter (the route supplies the clock). Fail-soft end
 * to end: a DB failure degrades to an empty-input report (available:false), never a
 * throw into the route. Dynamic RELATIVE imports (CI's tsx ESM loader cannot resolve
 * "@/" aliases in dynamic import positions) keep the analyzer's static graph pure.
 */
export async function buildNighthawkDebriefReport(opts: {
  days?: number;
  nowMs: number;
}): Promise<NighthawkDebriefReport> {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const through = etYmd(opts.nowMs);
  const since = etYmd(opts.nowMs - days * 24 * 60 * 60 * 1000);

  let rows: DebriefAggregateRow[] = [];
  let rejections: NighthawkGateRejectionInput[] = [];
  try {
    const db = await import("../../../lib/db");
    if (db.dbConfigured()) {
      const [{ rows: outcomeRows }, rejectionRows] = await Promise.all([
        db.fetchNighthawkOutcomeAnalytics(days),
        db.fetchNighthawkPublishGateRejections(days),
      ]);
      rows = outcomeRows;
      rejections = rejectionRows.map((r) => ({
        ticker: r.ticker,
        edition_for: r.edition_for,
        direction: r.direction,
        gate_codes: gateCodesFromSnapshot(r.input_snapshot),
        counterfactual: r.counterfactual_json,
      }));
    }
  } catch {
    // Report over empty input (available:false) — never a throw into the caller.
  }

  return analyzeNighthawkDebriefs({ rows, rejections, window: { since, through, days } });
}
